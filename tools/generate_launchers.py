#!/usr/bin/env python3
"""Render native launcher assets from the canonical NDDev mark and design tokens."""
import argparse
import hashlib
import io
import json
import platform
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
INPUTS = ['.gitattributes', 'assets/nddev-mark.svg', 'assets/brand-source.json', 'tokens/tokens.json',
          'tools/generate_launchers.py', 'tools/requirements-icons.txt', 'tools/with-renderer-zlib.sh']
RENDERER_VERSION = '12.3.0'
CANONICAL_RENDERER = {'platform': 'Linux-x86_64', 'python': '3.15.0',
                      'pillow': RENDERER_VERSION, 'zlib': '1.3.2'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require_renderer():
    import PIL
    from PIL import features
    actual = {'platform': platform.system() + '-' + platform.machine(),
              'python': platform.python_version(), 'pillow': PIL.__version__,
              'zlib': features.version('zlib')}
    if actual != CANONICAL_RENDERER:
        raise ValueError('Byte regeneration requires the canonical renderer: ' + str(CANONICAL_RENDERER) + '; actual: ' + str(actual))


def render(size):
    import PIL
    from PIL import Image, ImageDraw
    if PIL.__version__ != RENDERER_VERSION:
        raise ValueError('Install the pinned requirements-icons.txt renderer')
    if not 16 <= size <= 1024:
        raise ValueError('Launcher dimension must be 16..1024')
    source = json.loads((ROOT / 'assets/brand-source.json').read_text())
    svg = (ROOT / 'assets/nddev-mark.svg').read_bytes()
    if digest(svg) != source['svg_sha256']:
        raise ValueError('Canonical mark differs from its reviewed source')
    tokens = json.loads((ROOT / 'tokens/tokens.json').read_text())
    def color(key):
        group, name = source[key].split('.')
        return tokens[group][name]['$value']
    mark = ET.fromstring(svg)
    if mark.tag != '{http://www.w3.org/2000/svg}svg' or mark.get('viewBox') != '0 0 165.36 165.19':
        raise ValueError('Unsupported canonical SVG profile')
    # Native launcher safe area: the unchanged mark fits within 66/108 of the
    # square, leaving room for platform masks. Supersampling preserves edges.
    scale = size * 4
    image = Image.new('RGB', (scale, scale), color('background_token'))
    draw = ImageDraw.Draw(image)
    ratio = scale * (66 / 108) / 165.36
    offset = ((scale - 165.36 * ratio) / 2, (scale - 165.19 * ratio) / 2)
    if len(mark) != 3:
        raise ValueError('Expected the three reviewed polygons')
    for polygon in mark:
        if polygon.tag != '{http://www.w3.org/2000/svg}polygon' or set(polygon.attrib) != {'points'}:
            raise ValueError('Unsupported canonical SVG element')
        values = [float(value) for value in polygon.attrib['points'].split()]
        if len(values) % 2 or len(values) > 64:
            raise ValueError('Invalid bounded polygon')
        points = [(x * ratio + offset[0], y * ratio + offset[1]) for x, y in zip(values[::2], values[1::2])]
        draw.polygon(points, fill=color('foreground_token'))
    return image.resize((size, size), Image.Resampling.LANCZOS)


def png(size):
    output = io.BytesIO()
    render(size).save(output, format='PNG', compress_level=9, optimize=False)
    return output.getvalue()


def asset_sizes(root, target):
    if f'id: {target}\n' not in (root / 'module.yaml').read_text():
        raise ValueError('Destination is not the declared NDS runner repository')
    result = {}
    apple = 'macos' if target == 'desktop' else 'ios'
    icons = Path(apple) / 'Runner/Assets.xcassets/AppIcon.appiconset'
    entries = json.loads((root / icons / 'Contents.json').read_text())['images']
    if len(entries) > 64:
        raise ValueError('Unbounded launcher manifest')
    for item in entries:
        if 'filename' not in item:
            continue
        if Path(item['filename']).name != item['filename'] or not item['filename'].endswith('.png'):
            raise ValueError('Expected a local PNG filename in the launcher manifest')
        size = round(float(item['size'].split('x')[0]) * float(item['scale'].removesuffix('x')))
        name = str(icons / item['filename']).replace('\\', '/')
        if not 16 <= size <= 1024 or name in result and result[name] != size:
            raise ValueError('Invalid or conflicting launcher dimensions')
        result[name] = size
    if target == 'desktop':
        result['windows/runner/resources/app_icon.ico'] = 256
        result['linux/runner/resources/app_icon.png'] = 256
    else:
        for density, size in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
            result[f'android/app/src/main/res/mipmap-{density}/ic_launcher.png'] = size
    return result


def assets(root, target):
    require_renderer()
    result = {}
    for name, size in asset_sizes(root, target).items():
        if name.endswith('.ico'):
            output = io.BytesIO()
            render(size).save(output, format='ICO', sizes=[(v, v) for v in [16, 24, 32, 48, 64, 128, 256]])
            result[name] = output.getvalue()
        else:
            result[name] = png(size)
    return result


def verify(root, target, source):
    record = json.loads((root / 'generated/launcher-provenance.json').read_text())
    names = set(asset_sizes(root, target))
    if set(record) != {'source', 'files_sha256'} or record['source'] != source:
        raise ValueError('Launcher source/input/renderer provenance differs')
    if set(record['files_sha256']) != names:
        raise ValueError('Launcher inventory differs from its provenance')
    for name in names:
        path = root / name
        if not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('Launcher asset is missing or exceeds its bound')
        if digest(path.read_bytes()) != record['files_sha256'][name]:
            raise ValueError('Committed launcher bytes differ: ' + name)
    return len(names)


def source_identity():
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    hashes = {}
    for name in INPUTS:
        content = (ROOT / name).read_bytes()
        published = subprocess.check_output(['git', 'show', f'{commit}:{name}'], cwd=ROOT)
        if content != published:
            raise ValueError('Launcher generation requires committed canonical inputs')
        hashes[name] = digest(content)
    return {'repository': 'NDDev-Technocracy-OpenNetwork-NDS/nddev-opennetwork-design-system',
            'commit': commit, 'inputs_sha256': hashes, 'renderer': CANONICAL_RENDERER}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--desktop', type=Path)
    parser.add_argument('--mobile', type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Strict canonical Linux byte regeneration')
    mode.add_argument('--verify', action='store_true', help='Verify committed source/input/output SHA on any host')
    args = parser.parse_args()
    if not args.desktop and not args.mobile:
        parser.error('An existing desktop or mobile runner repository is required')
    source = source_identity()
    for platform in ['desktop', 'mobile']:
        root = getattr(args, platform)
        if root is None:
            continue
        if args.verify:
            count = verify(root, platform, source)
            print(f'{platform}: {count} committed launcher assets and canonical provenance verified')
            continue
        generated = assets(root, platform)
        record = {'source': source, 'files_sha256': {name: digest(data) for name, data in sorted(generated.items())}}
        generated['generated/launcher-provenance.json'] = (json.dumps(record, indent=2, sort_keys=True) + '\n').encode()
        for name, data in generated.items():
            path = root / name
            if args.check:
                if not path.is_file() or path.read_bytes() != data:
                    raise SystemExit(f'Launcher drift: {name}')
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        print(f'{platform}: {len(generated)-1} launcher assets verified' if args.check else f'{platform}: {len(generated)-1} launcher assets generated')

if __name__ == '__main__':
    main()
