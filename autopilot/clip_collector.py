import os
import sys
import time
import hashlib
import msvcrt
import subprocess
from pathlib import Path
from PIL import ImageGrab, Image

SCRIPT_DIR = Path(__file__).resolve().parent
DIR_INPUT = SCRIPT_DIR / "input"
DIR_INPUT.mkdir(parents=True, exist_ok=True)

def main():
    print("=" * 68)
    print("   📸 NBLM 投影片連續截圖自動收集器 (Continuous Screenshot Collector)")
    print("=" * 68)
    print("👉 請直接在螢幕上按 [Win + Shift + S] 依序截取簡報頁面 (可自由截取任意頁數，如 6 頁、10 頁、15 頁或整份簡報)")
    print("   每截一張，系統會自動儲存為 input/slide_01.png, slide_02.png...")
    print("👉 收集完成後，隨時回到此視窗按 [Enter]，系統將自動完整分析所有收集到的頁面！")
    print("👉 按 [Q] 可取消並結束程式。")
    print("=" * 68)
    print("👀 正在監聽 Windows 剪貼簿截圖事件...\n", flush=True)

    # 檢查 input 目前已有的 slide 圖片數量
    existing_slides = sorted(list(DIR_INPUT.glob("slide_*.png")))
    count = len(existing_slides)
    last_hash = None

    if existing_slides:
        try:
            with Image.open(existing_slides[-1]) as img:
                last_hash = hashlib.md5(img.tobytes()).hexdigest()
            print(f"ℹ️  偵測到 input/ 內已有 {count} 張圖片，將從 slide_{count+1:02d}.png 繼續追加。", flush=True)
            print("   (若要從頭全新截圖，可先清空 input 資料夾中的舊圖片)\n", flush=True)
        except Exception:
            pass

    # 初始讀取一次剪貼簿，避免將啟動前的歷史舊截圖誤當作新的一頁
    try:
        init_clip = ImageGrab.grabclipboard()
        if init_clip and isinstance(init_clip, Image.Image):
            last_hash = hashlib.md5(init_clip.tobytes()).hexdigest()
    except Exception:
        pass

    while True:
        # 檢查鍵盤按鍵 (非阻塞)
        if msvcrt.kbhit():
            ch = msvcrt.getch()
            if ch in (b'\r', b'\n'):
                print(f"\n🎉 截圖收集結束！共收集 {count} 張投影片圖片。", flush=True)
                if count > 0:
                    print(f"🚀 正在啟動 Auto-Pilot，本次將完整分析您收集的全部 {count} 頁簡報...\n", flush=True)
                    res = subprocess.run([sys.executable, "-u", "nblm_pilot.py", "--limit", str(count)], cwd=str(SCRIPT_DIR))
                    print("\n" + "=" * 68, flush=True)
                    if res.returncode == 0:
                        print("✨ Auto-Pilot 閉環優化全流程已順利完成！", flush=True)
                        print("📊 評估報告已儲存於: autopilot/output/04_evaluations/evaluation_report.md", flush=True)
                        print("📦 最新約束規則已自動合併至 guardrails.json 並推播至 GitHub！", flush=True)
                    else:
                        print(f"❌ Auto-Pilot 執行過程發生異常 (Exit Code: {res.returncode})", flush=True)
                        print("⚠️ 請查看上方執行紀錄以排查問題。", flush=True)
                    print("=" * 68, flush=True)
                    while True:
                        print("\n📌 視窗已為您保持開啟，供您檢視上方 AI 質檢與對比評分！")
                        print("   [1] 開啟「本次完整 AI 視覺評估與評分報告」(Markdown 檔案)")
                        print("   [2] 開啟「NotebookLM 生成投影片截圖」資料夾")
                        print("   [3] 開啟「原始輸入投影片抽樣」資料夾")
                        print("   [Q] 關閉此視窗")
                        try:
                            choice = input("👉 請輸入選項 [1/2/3/Q，按 Enter 保持視窗開啟]: ").strip().lower()
                            if choice == "1":
                                rep_file = SCRIPT_DIR / "output/04_evaluations/evaluation_report.md"
                                if rep_file.exists():
                                    os.startfile(str(rep_file))
                            elif choice == "2":
                                out_dir = SCRIPT_DIR / "output/03_nblm_slides"
                                if out_dir.exists():
                                    os.startfile(str(out_dir))
                            elif choice == "3":
                                ext_dir = SCRIPT_DIR / "output/01_extracted"
                                if ext_dir.exists():
                                    os.startfile(str(ext_dir))
                            elif choice in ("q", "quit", "exit"):
                                break
                        except Exception:
                            break
                else:
                    print("⚠️ 未收集到任何圖片，請按 Win+Shift+S 截圖後再按 Enter。", flush=True)
                break
            elif ch in (b'q', b'Q', b'\x1b'):  # Q 或 ESC
                print("\n已結束截圖收集模式。", flush=True)
                break

        # 檢查剪貼簿是否有新圖片
        try:
            clip = ImageGrab.grabclipboard()
            if clip and isinstance(clip, Image.Image):
                cur_hash = hashlib.md5(clip.tobytes()).hexdigest()
                if cur_hash != last_hash:
                    count += 1
                    save_path = DIR_INPUT / f"slide_{count:02d}.png"
                    clip.convert("RGB").save(save_path, "PNG")
                    last_hash = cur_hash
                    w, h = clip.size
                    print(f"✅ [已收集第 {count} 頁] 成功儲存 -> input/{save_path.name} ({w}x{h})", flush=True)
                    try:
                        import winsound
                        winsound.MessageBeep(winsound.MB_ICONASTERISK)
                    except Exception:
                        print("\a", end="", flush=True)
        except Exception:
            pass

        time.sleep(0.35)

if __name__ == "__main__":
    main()
