import struct, zlib, os, math

def make_png(w, h, pixels_rgba):
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)
    raw = bytearray()
    for row in pixels_rgba:
        raw += b'\x00'
        for r, g, b, a in row:
            raw += bytes([r, g, b, a])
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', zlib.compress(bytes(raw), 9)) +
            chunk(b'IEND', b''))

def in_rrect(x, y, x1, y1, x2, y2, r):
    if x < x1 or x > x2 or y < y1 or y > y2:
        return False
    cx = max(x1 + r, min(x2 - r, x))
    cy = max(y1 + r, min(y2 - r, y))
    return (x - cx)**2 + (y - cy)**2 <= r**2

def draw_lock(size):
    s = float(size)
    BG    = (0, 120, 212, 255)
    WHITE = (255, 255, 255, 255)
    TRANS = (0, 0, 0, 0)
    cr = s * 0.18
    bx1, bx2 = s*0.17, s*0.83
    by1, by2 = s*0.48, s*0.86
    br = s * 0.07
    sh_cx = s * 0.50
    sh_cy = s * 0.42
    sh_out = s * 0.30
    sh_in  = s * 0.18
    kh_cx, kh_cy = s*0.50, s*0.63
    kh_r = s * 0.09
    kh_sw = s * 0.065
    kh_sy2 = s * 0.79

    pixels = []
    for y in range(size):
        yf = y + 0.5
        row = []
        for x in range(size):
            xf = x + 0.5
            if not in_rrect(xf, yf, 0, 0, s, s, cr):
                row.append(TRANS)
                continue
            in_body = in_rrect(xf, yf, bx1, by1, bx2, by2, br)
            dx, dy = xf - sh_cx, yf - sh_cy
            d = math.sqrt(dx*dx + dy*dy)
            in_arc = (sh_in <= d <= sh_out) and yf <= sh_cy + 1
            in_ll  = (sh_cx - sh_out <= xf <= sh_cx - sh_in) and (sh_cy <= yf <= by1 + 2)
            in_rl  = (sh_cx + sh_in  <= xf <= sh_cx + sh_out) and (sh_cy <= yf <= by1 + 2)
            in_shackle = in_arc or in_ll or in_rl
            kdx = xf - kh_cx
            in_kh = ((kdx*kdx + (yf-kh_cy)**2) <= kh_r*kh_r or
                     (abs(kdx) <= kh_sw and kh_cy <= yf <= kh_sy2))
            if in_shackle or in_body:
                row.append(BG if (in_body and in_kh) else WHITE)
            else:
                row.append(BG)
        pixels.append(row)
    return pixels

os.makedirs('icons', exist_ok=True)
for sz in [16, 32, 48, 128]:
    data = make_png(sz, sz, draw_lock(sz))
    with open(f'icons/icon{sz}.png', 'wb') as f:
        f.write(data)
    print(f'icons/icon{sz}.png  ({len(data)} bytes)')
print('Done.')
