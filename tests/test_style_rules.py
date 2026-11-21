import ast
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import fitz
from fastapi.testclient import TestClient
import app
import pptx
from pptx_handler import process_pptx_presentation

ROOT = Path(app.__file__).parent


class StyleRulesTests(unittest.TestCase):
    def setUp(self):
        limiter = patch.object(app, 'rate_limiter', app.InMemoryRateLimiter())
        limiter.start()
        self.addCleanup(limiter.stop)

    @staticmethod
    def pdf_bytes(pages):
        with fitz.open() as document:
            for _ in range(pages):
                document.new_page(width=160, height=90)
            return document.tobytes()

    def analyze_uploads(self, uploads, selected=None):
        calls = []
        def generate(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='test'))])
        fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=generate)))
        data = {'provider': 'openai', 'model': 'gpt-4o'}
        if selected is not None:
            data['selected_pages'] = selected
        with patch.object(app.openai, 'OpenAI', return_value=fake), TestClient(app.app) as client:
            response = client.post('/api/analyze', headers={'x-api-key': 'test-placeholder'}, data=data,
                                   files=[('files', upload) for upload in uploads])
        return response, calls

    def test_metadata_is_found_before_report_even_with_missing_fence(self):
        value = {'style_name': 'escaped " brace }', 'palette': [], 'design_profile': {'pages': []}}
        encoded = json.dumps(value)
        for suffix in ['','\n```','\n## Evidence\n```markdown\nPrompt\n```']:
            self.assertEqual(app.extract_style_metadata('```JSON\n' + encoded + suffix), value)
        self.assertIsNone(app.extract_style_metadata('```json\n' + encoded[:-2]))
        self.assertEqual(app.extract_style_metadata('```json\n' + encoded + '\n```\n```json\n{"unrelated": 1}\n```'), value)

    def test_quality_module_route_serves_the_same_public_file(self):
        with TestClient(app.app) as client:
            response = client.get('/style-quality.js')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, (ROOT / 'style-quality.js').read_bytes())

    def test_multiple_pdfs_use_a_single_global_thirty_page_budget(self):
        pdf = self.pdf_bytes(40)
        response, calls = self.analyze_uploads([('a.pdf', pdf, 'application/pdf'), ('b.pdf', pdf, 'application/pdf')])
        self.assertEqual(response.status_code, 200, response.text)
        parts = calls[0]['messages'][1]['content']
        labels = [p['text'] for p in parts if p['type'] == 'text' and p['text'].startswith('來源頁：')]
        self.assertEqual(len(labels), 30)
        self.assertEqual(labels[0], '來源頁：P.1')
        self.assertEqual(labels[-1], '來源頁：P.80')

    def test_selection_above_three_hundred_is_not_discarded(self):
        pdf = self.pdf_bytes(120)
        response, calls = self.analyze_uploads([(f'{name}.pdf', pdf, 'application/pdf') for name in ['a', 'b', 'c']], '301,360')
        self.assertEqual(response.status_code, 200, response.text)
        parts = calls[0]['messages'][1]['content']
        labels = [p['text'] for p in parts if p['type'] == 'text' and p['text'].startswith('來源頁：')]
        self.assertEqual(labels, ['來源頁：P.301', '來源頁：P.360'])
        context = response.json()['analysis_context']
        self.assertEqual(context['source_pages'], ['P.301', 'P.360'])
        self.assertEqual([p['source_page'] for p in context['pixel_evidence']], ['P.301', 'P.360'])
        self.assertTrue(all(p['lightRatio'] > .99 for p in context['pixel_evidence']))


    def test_unselected_pptx_and_image_never_enter_the_model_request(self):
        from PIL import Image
        presentation = pptx.Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        image = io.BytesIO()
        Image.new('RGB', (10, 10), 'red').save(image, format='PNG')
        slide.shapes.add_picture(io.BytesIO(image.getvalue()), 0, 0)
        stream = io.BytesIO()
        presentation.save(stream)
        response, calls = self.analyze_uploads([
            ('selected.pdf', self.pdf_bytes(2), 'application/pdf'),
            ('excluded.pptx', stream.getvalue(), 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
            ('excluded.png', image.getvalue(), 'image/png'),
        ], '1')
        self.assertEqual(response.status_code, 200, response.text)
        content = calls[0]['messages'][1]['content']
        self.assertEqual(sum(p['type'] == 'image_url' for p in content), 1)
        text = '\n'.join(p['text'] for p in content if p['type'] == 'text')
        self.assertNotIn('excluded', text)
        self.assertNotIn('PPTX 結構解析', text)

    def test_invalid_selection_does_not_fall_back_to_all_pages(self):
        for selection in ['999999', 'invalid', '1,999999', '3']:
            response, calls = self.analyze_uploads([('a.pdf', self.pdf_bytes(2), 'application/pdf')], selection)
            self.assertEqual(response.status_code, 400, selection)
            self.assertEqual(calls, [])

    def test_backend_pdf_preview_includes_last_page_after_thirty(self):
        with fitz.open() as document:
            for _ in range(31):
                document.new_page(width=160, height=90)
            pdf = document.tobytes()
        with TestClient(app.app) as client:
            response = client.post('/api/preview', files={'file': ('sample.pdf', pdf, 'application/pdf')})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['preview_pages']), 31)
        self.assertEqual(response.json()['preview_pages'][-1]['page'], 31)

    def test_backend_samples_pdf_with_and_without_explicit_selection(self):
        with fitz.open() as document:
            for _ in range(40):
                document.new_page(width=160, height=90)
            pdf = document.tobytes()
        for selected, first in [(None, 1), (','.join(map(str, range(2, 41))), 2)]:
            calls = []
            def generate(**kwargs):
                calls.append(kwargs)
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='test'))])
            fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=generate)))
            data = {'provider': 'openai', 'model': 'gpt-4o'}
            if selected:
                data['selected_pages'] = selected
            with patch.object(app.openai, 'OpenAI', return_value=fake), TestClient(app.app) as client:
                response = client.post('/api/analyze', headers={'x-api-key': 'test-placeholder'}, data=data,
                                       files={'files': ('sample.pdf', pdf, 'application/pdf')})
            self.assertEqual(response.status_code, 200, response.text)
            parts = calls[0]['messages'][1]['content']
            labels = [p['text'] for p in parts if p['type'] == 'text' and p['text'].startswith('來源頁：')]
            self.assertEqual(len(labels), 30)
            self.assertEqual(labels[0], f'來源頁：P.{first}')
            self.assertEqual(labels[-1], '來源頁：P.40')

    def test_pptx_preview_and_analysis_include_last_page(self):
        presentation = pptx.Presentation()
        for _ in range(32):
            presentation.slides.add_slide(presentation.slide_layouts[6])
        stream = io.BytesIO()
        presentation.save(stream)
        content = stream.getvalue()
        for selected, first in [(None, 1), (set(range(2, 33)), 2)]:
            result = process_pptx_presentation(content, target_pages=selected)
            self.assertEqual(len(result['preview_pages']), 30)
            self.assertEqual(result['preview_pages'][0]['page'], first)
            self.assertEqual(result['preview_pages'][-1]['page'], 32)
        with TestClient(app.app) as client:
            response = client.post('/api/preview', files={'file': ('sample.pptx', content, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['preview_pages']), 32)

    def test_pixel_evidence_distinguishes_light_and_dark_pages_in_provider_prompt(self):
        from PIL import Image
        uploads = []
        for name, color in [("light.png", "white"), ("dark.png", "black")]:
            buffer = io.BytesIO()
            Image.new("RGB", (160, 90), color).save(buffer, format="PNG")
            uploads.append((name, buffer.getvalue(), "image/png"))
        response, calls = self.analyze_uploads(uploads)
        self.assertEqual(response.status_code, 200, response.text)
        prompt = calls[0]["messages"][1]["content"][0]["text"]
        self.assertIn("P.1：近白像素 100.0%", prompt)
        self.assertIn("P.2：近白像素 0.0%；近黑像素 100.0%", prompt)
        self.assertIn("不代表精確品牌色或物件色", prompt)

    def test_gemini_auto_reaches_validated_model_without_legacy_retries(self):
        from unittest.mock import Mock
        def reply(**kwargs):
            if kwargs['model'] != 'gemini-3.5-flash-lite':
                raise RuntimeError('404 model not found')
            return SimpleNamespace(text='test')
        generate = Mock(side_effect=reply)
        fake = SimpleNamespace(models=SimpleNamespace(generate_content=generate))
        with patch.object(app.genai, 'Client', return_value=fake), TestClient(app.app) as client:
            response = client.post('/api/analyze', headers={'x-api-key': 'test-placeholder'},
                                   data={'provider': 'gemini', 'model': 'auto'},
                                   files=[('files', ('sample.pdf', self.pdf_bytes(1), 'application/pdf'))])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['model_used'], 'gemini-3.5-flash-lite')
        self.assertEqual(generate.call_count, 1)

    def test_provider_busy_is_reported_as_unavailable_not_bad_file(self):
        from unittest.mock import Mock
        fake = SimpleNamespace(models=SimpleNamespace(generate_content=Mock(side_effect=RuntimeError("503 UNAVAILABLE: high demand"))))
        with patch.object(app.genai, "Client", return_value=fake), TestClient(app.app) as client:
            response = client.post("/api/analyze", headers={"x-api-key": "test-placeholder"},
                                   data={"provider": "gemini", "model": "auto"},
                                   files=[("files", ("sample.pdf", self.pdf_bytes(1), "application/pdf"))])
        self.assertEqual(response.status_code, 503)
        self.assertIn("忙碌", response.json()["detail"])

    def test_project_spend_cap_is_not_retried_as_a_model_rate_limit(self):
        from unittest.mock import Mock
        generate = Mock(side_effect=RuntimeError("429 RESOURCE_EXHAUSTED: monthly spending cap"))
        fake = SimpleNamespace(models=SimpleNamespace(generate_content=generate))
        with patch.object(app.genai, "Client", return_value=fake), TestClient(app.app) as client:
            response = client.post("/api/analyze", headers={"x-api-key": "test-placeholder"},
                                   data={"provider": "gemini", "model": "auto"},
                                   files=[("files", ("sample.pdf", self.pdf_bytes(1), "application/pdf"))])
        self.assertEqual(response.status_code, 429)
        self.assertIn("每月支出上限", response.json()["detail"])
        self.assertEqual(generate.call_count, 1)

    def test_frontend_security_policy_and_icons_match_public_entry(self):
        import re
        with TestClient(app.app) as client:
            response = client.get("/")
            policy = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', response.text).group(1)
            self.assertEqual(response.headers["content-security-policy"], policy)
            for name in ["favicon.svg", "favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png"]:
                with self.subTest(name=name):
                    asset = client.get("/" + name)
                    self.assertEqual(asset.status_code, 200)
                    self.assertEqual(asset.content, (ROOT / name).read_bytes())

    def test_shared_instruction_and_public_routes(self):
        config = json.loads((ROOT / 'guardrails.json').read_text(encoding='utf-8'))
        self.assertEqual(app.get_system_instruction(), config['system_instruction'] + '\n' + '\n'.join(r['rule'] for r in config['rules']))
        with TestClient(app.app) as client:
            for url, name in [('/', 'index.html'), ('/index.html', 'index.html'), ('/app.js', 'app.js'), ('/style.css', 'style.css'), ('/guardrails.json', 'guardrails.json')]:
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, (ROOT / name).read_bytes())
            self.assertEqual(client.get('/app.py').status_code, 404)

    def test_selected_pdf_pages_reach_openai_without_six_page_truncation(self):
        document = fitz.open()
        for _ in range(9):
            document.new_page(width=160, height=90)
        pdf = document.tobytes()
        document.close()
        calls = []

        def generate(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='```json\n{"style_name":"test","palette":[],"design_profile":{"rules":[],"layouts":[]}}\n```'))])

        fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=generate)))
        with patch.object(app.openai, 'OpenAI', return_value=fake), TestClient(app.app) as client:
            response = client.post('/api/analyze', headers={'x-api-key': 'test-placeholder'},
                                   data={'provider': 'openai', 'model': 'gpt-4o', 'selected_pages': '1,2,3,4,5,6,7,9'},
                                   files={'files': ('sample.pdf', pdf, 'application/pdf')})
        self.assertEqual(response.status_code, 200, response.text)
        content = calls[0]['messages'][1]['content']
        self.assertEqual(sum(part['type'] == 'image_url' for part in content), 8)
        labels = [part['text'] for part in content if part['type'] == 'text']
        self.assertIn('來源頁：P.9', labels)
        self.assertNotIn('來源頁：P.8', labels)
        self.assertIn('design_profile', response.json()['structured_meta'])

    def test_case_feedback_does_not_change_global_rules_or_publish(self):
        # Load only the feedback functions; never initialize browser automation.
        pilot = ROOT / 'autopilot' / 'nblm_pilot.py'
        module = ast.parse(pilot.read_text(encoding='utf-8'))
        names = {'extract_rules_from_report', 'auto_harden_and_sync_website'}
        subset = ast.Module(body=[n for n in module.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
        import re
        import time
        from typing import List, Dict
        with tempfile.TemporaryDirectory() as directory:
            namespace = {'json': json, 're': re, 'time': time, 'List': List, 'Dict': Dict,
                         'DIR_EVALUATIONS': Path(directory)}
            exec(compile(subset, str(pilot), 'exec'), namespace)
            before = (ROOT / 'guardrails.json').read_bytes()
            namespace['auto_harden_and_sync_website']({'report_markdown': 'Case-specific feedback', 'report_path': 'case.md'}, {})
            namespace['auto_harden_and_sync_website']({'report_markdown': 'Second feedback', 'report_path': 'case2.md'}, {})
            records = list(Path(directory).glob('pending_rules_*.json'))
            self.assertEqual(len(records), 2)
            self.assertTrue(all(json.loads(p.read_text(encoding='utf-8'))['status'] == 'pending_review' for p in records))
            self.assertEqual((ROOT / 'guardrails.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
