import io
import zipfile
import base64
import logging
from typing import List, Dict, Any, Tuple
from PIL import Image, ImageDraw, ImageFont
import pptx
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

logger = logging.getLogger("nblm-reverser")

def rgb_to_hex(rgb: RGBColor) -> str:
    try:
        return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}".upper()
    except Exception:
        return "#64748B"

def extract_pptx_media(content_bytes: bytes) -> List[Tuple[str, bytes]]:
    """從 PPTX 壓縮包 (ppt/media/) 中提取出原始嵌入的圖像素材 (背景、插圖、圖示)"""
    extracted_images = []
    try:
        with zipfile.ZipFile(io.BytesIO(content_bytes)) as z:
            for filename in z.namelist():
                if filename.startswith("ppt/media/") and filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                    img_data = z.read(filename)
                    if len(img_data) > 1024:  # 過濾極小的 1px 佔位圖
                        extracted_images.append((filename, img_data))
    except Exception as e:
        logger.warning(f"PPTX 媒體提取失敗: {e}")
    return extracted_images

def render_slide_wireframe(slide, slide_w: int, slide_h: int, target_w: int = 960) -> Image.Image:
    """
    使用 PIL 根據 PPTX 形狀、背景與文字框的位置與顏色，
    繪製出該頁投影片的視覺預覽縮圖
    """
    target_h = int(target_w * (slide_h / slide_w))
    scale_x = target_w / slide_w
    scale_y = target_h / slide_h

    # 預設底色（深色或白色底）
    img = Image.new("RGB", (target_w, target_h), (15, 23, 42))  # #0F172A
    draw = ImageDraw.Draw(img)

    for shape in slide.shapes:
        try:
            x = int(shape.left * scale_x)
            y = int(shape.top * scale_y)
            w = int(shape.width * scale_x)
            h = int(shape.height * scale_y)

            # 繪製形狀方塊 / 卡片
            if shape.has_text_frame or shape.shape_type:
                # 填充色檢測
                fill_color = (30, 41, 59)  # 預設深色卡片
                outline_color = (71, 85, 105)
                
                try:
                    if shape.fill and shape.fill.type == 1 and shape.fill.fore_color.type == 1:
                        c = shape.fill.fore_color.rgb
                        fill_color = (c[0], c[1], c[2])
                except Exception:
                    pass

                # 畫圓角或矩形卡片
                draw.rectangle([x, y, x + w, y + h], fill=fill_color, outline=outline_color, width=1)

                # 繪製文字區域佔位線
                if shape.has_text_frame and shape.text.strip():
                    text = shape.text.strip()
                    # 判斷是否為大標題
                    is_title = (shape == slide.shapes.title) or len(text) < 30
                    text_color = (255, 255, 255) if is_title else (203, 213, 225)
                    
                    # 畫精簡文字或線條代表排版
                    display_text = text[:40] + ("..." if len(text) > 40 else "")
                    draw.text((x + 8, y + 8), display_text, fill=text_color)
        except Exception:
            continue

    return img

def process_pptx_presentation(content_bytes: bytes) -> Dict[str, Any]:
    """
    完整處理 PPTX：提取文字架構、字型規範、色彩清單、媒體圖片與每頁預覽
    """
    prs = pptx.Presentation(io.BytesIO(content_bytes))
    total_slides = len(prs.slides)
    slide_w = prs.slide_width
    slide_h = prs.slide_height

    aspect_ratio = "16:9" if round(slide_w / slide_h, 2) >= 1.7 else "4:3"
    
    preview_pages = []
    structure_lines = [
        f"【PPTX 結構解析】",
        f"- 總投影片頁數: {total_slides} 頁",
        f"- 投影片長寬比例: {aspect_ratio} ({slide_w} x {slide_h})"
    ]

    detected_fonts = set()
    detected_colors = set()

    # 處理前 6 頁預覽
    max_slides = min(total_slides, 6)
    for idx in range(max_slides):
        slide = prs.slides[idx]
        slide_title = ""
        slide_elements = []

        if slide.shapes.title and slide.shapes.title.text:
            slide_title = slide.shapes.title.text.strip()

        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    for run in para.runs:
                        if run.font.name:
                            detected_fonts.add(run.font.name)
                        try:
                            if run.font.color and run.font.color.type == 1:
                                detected_colors.add(rgb_to_hex(run.font.color.rgb))
                        except Exception:
                            pass
            try:
                if shape.fill and shape.fill.type == 1 and shape.fill.fore_color.type == 1:
                    detected_colors.add(rgb_to_hex(shape.fill.fore_color.rgb))
            except Exception:
                pass

        # 渲染縮圖
        wireframe_img = render_slide_wireframe(slide, slide_w, slide_h, target_w=640)
        buf = io.BytesIO()
        wireframe_img.save(buf, format="JPEG", quality=85)
        b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")

        preview_pages.append({
            "page": idx + 1,
            "title": slide_title or f"第 {idx + 1} 頁",
            "image": f"data:image/jpeg;base64,{b64_str}",
            "bytes": buf.getvalue()
        })

        structure_lines.append(f"\n[投影片 {idx + 1} 結構]")
        if slide_title:
            structure_lines.append(f"- 標題: {slide_title}")
        structure_lines.append(f"- 形狀與卡片組件數: {len(slide.shapes)}")

    if detected_fonts:
        structure_lines.append(f"\n【檢測到的字型家族 (Font Families)】: {', '.join(list(detected_fonts)[:6])}")
    if detected_colors:
        structure_lines.append(f"【檢測到的物件與文字顏色 (Colors)】: {', '.join(list(detected_colors)[:8])}")

    # 提取嵌入媒體影像
    media_images = extract_pptx_media(content_bytes)
    structure_lines.append(f"【嵌入之原創高畫質素材數量】: 共 {len(media_images)} 個媒體圖片")

    return {
        "total_slides": total_slides,
        "aspect_ratio": aspect_ratio,
        "preview_pages": preview_pages,
        "media_images": media_images,
        "structure_summary": "\n".join(structure_lines),
        "detected_fonts": list(detected_fonts),
        "detected_colors": list(detected_colors)
    }
