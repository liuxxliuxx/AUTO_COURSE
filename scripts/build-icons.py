"""Convert the approved raster source into native icon formats. Requires Pillow."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
source = Image.open(root / 'assets/icon-source.png').convert('RGBA')
image = source.resize((1024, 1024), Image.Resampling.LANCZOS)
image.save(root / 'assets/icon.png')
image.save(root / 'assets/icon.ico', sizes=[(s,s) for s in (16,24,32,48,64,128,256)])
image.save(root / 'assets/icon.icns', format='ICNS')
folder = root / 'assets/icons'
folder.mkdir(exist_ok=True)
for size in (16,24,32,48,64,128,256,512,1024):
    image.resize((size,size), Image.Resampling.LANCZOS).save(folder / f'icon-{size}.png')
