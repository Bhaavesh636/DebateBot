import os
from pypdf import PdfReader

pdf_path = r"d:\Projects\DebateBot\misc\Summer_Training_Report_WebRAG.docx.pdf"
output_dir = r"d:\Projects\DebateBot\misc"

reader = PdfReader(pdf_path)
image_count = 0

for i, page in enumerate(reader.pages):
    print(f"Checking page {i+1} for images...")
    for image_file_object in page.images:
        image_count += 1
        name = f"extracted_image_{i+1}_{image_count}.png"
        with open(os.path.join(output_dir, name), "wb") as fp:
            fp.write(image_file_object.data)
        print(f"Saved {name}")

print(f"Total images extracted: {image_count}")
