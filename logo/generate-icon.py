#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFilter
import os

ICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ICON_DIR, 'app-icon-1024.png')
ICONSET = os.path.join(ICON_DIR, 'app-icon.iconset')

SIZES = [
    ('icon_16x16.png', 16),
    ('icon_16x16@2x.png', 32),
    ('icon_32x32.png', 32),
    ('icon_32x32@2x.png', 64),
    ('icon_128x128.png', 128),
    ('icon_128x128@2x.png', 256),
    ('icon_256x256.png', 256),
    ('icon_256x256@2x.png', 512),
    ('icon_512x512.png', 512),
    ('icon_512x512@2x.png', 1024),
]

def create_macos_icon(src_path, size):
    """
    macOS Big Sur+ icon spec:
    - 1024x1024 canvas
    - Content area: ~824x824 (80.5% of canvas)
    - Corner radius: ~185px (proportional to content)
    - Shadow: 28px blur, 12px Y offset, 50% opacity black
    """
    canvas_size = size
    # Use 70% to leave more visible margin (was 78%, Apple spec is 80.5%)
    content_ratio = 0.70
    content_size = int(canvas_size * content_ratio)
    offset = (canvas_size - content_size) // 2
    
    # Corner radius proportional to content size (185.4/824 ≈ 0.225)
    corner_radius = int(content_size * 0.225)
    
    canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    src = Image.open(src_path).convert('RGBA')
    src_resized = src.resize((content_size, content_size), Image.LANCZOS)
    
    # Create rounded mask
    mask = Image.new('L', (content_size, content_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, content_size - 1, content_size - 1], radius=corner_radius, fill=255)
    
    # Apply mask to content
    content = Image.new('RGBA', (content_size, content_size), (0, 0, 0, 0))
    content.paste(src_resized, (0, 0))
    content.putalpha(mask)
    
    # Shadow: 28px blur, 12px Y offset, black at 40% opacity
    shadow_blur = max(1, int(size * 28.0 / 1024.0))
    shadow_offset_y = max(1, int(size * 12.0 / 1024.0))
    
    shadow_layer = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    shadow_mask = Image.new('L', (content_size, content_size), 0)
    shadow_draw = ImageDraw.Draw(shadow_mask)
    shadow_draw.rounded_rectangle([0, 0, content_size - 1, content_size - 1], radius=corner_radius, fill=100)
    shadow_layer.paste(shadow_mask, (offset, offset + shadow_offset_y))
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
    
    # Composite: shadow first, then content on top
    canvas = Image.alpha_composite(canvas, shadow_layer)
    canvas.paste(content, (offset, offset), content)
    
    return canvas

os.makedirs(ICONSET, exist_ok=True)

for filename, size in SIZES:
    icon = create_macos_icon(SOURCE, size)
    icon.save(os.path.join(ICONSET, filename), 'PNG')
    print(f'  Created {filename} ({size}x{size})')

print('Iconset generated successfully!')
