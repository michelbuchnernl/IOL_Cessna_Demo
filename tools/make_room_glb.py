"""Generate the low-poly classroom shell used by the klaslokaal experience.

One mesh, one material, flat vertex colours (no textures, no lights in the file), ~140 triangles.
Run:  python3 tools/make_room_glb.py
Writes: public/assets/experiences/iol-klaslokaal-demo/environments/room.glb

Room: x -3..3, z -3.5..2.5, height 3 m. Players start at the origin, the plinth for the object is at (0, -1.5).
"""
import json
import math
import os
import struct

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "experiences",
                   "iol-klaslokaal-demo", "environments", "room.glb")

X0, X1, Z0, Z1, HEIGHT = -3.0, 3.0, -3.5, 2.5, 3.0
PLINTH_CENTER = (0.0, -1.5)
PLINTH_RADIUS, PLINTH_HEIGHT, PLINTH_SEGMENTS = 0.7, 0.9, 16

positions, normals, colors, indices = [], [], [], []


def srgb(hex_value):
    """Vertex colours are linear in glTF, so convert from the sRGB hex values."""
    out = []
    for shift in (16, 8, 0):
        channel = ((hex_value >> shift) & 255) / 255
        out.append(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def quad(corners, normal, color):
    base = len(positions)
    for corner in corners:
        positions.append(corner)
        normals.append(normal)
        colors.append(color)
    indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])


# Floor: 1 m tiles in two greys.
floor_a, floor_b = srgb(0xB8BEC6), srgb(0xA3AAB3)
for ix in range(int(X1 - X0)):
    for iz in range(int(Z1 - Z0)):
        x, z = X0 + ix, Z0 + iz
        quad([(x, 0, z + 1), (x + 1, 0, z + 1), (x + 1, 0, z), (x, 0, z)], (0, 1, 0),
             floor_a if (ix + iz) % 2 == 0 else floor_b)

# Ceiling.
quad([(X0, HEIGHT, Z0), (X1, HEIGHT, Z0), (X1, HEIGHT, Z1), (X0, HEIGHT, Z1)], (0, -1, 0), srgb(0xF3F5F7))

# Walls (facing inward), lower band blue, upper band off-white.
band = 1.1
lower, upper = srgb(0x3B6EA5), srgb(0xE9EDF1)
for (ya, yb, color) in ((0, band, lower), (band, HEIGHT, upper)):
    quad([(X0, ya, Z0), (X1, ya, Z0), (X1, yb, Z0), (X0, yb, Z0)], (0, 0, 1), color)      # back wall
    quad([(X1, ya, Z1), (X0, ya, Z1), (X0, yb, Z1), (X1, yb, Z1)], (0, 0, -1), color)     # front wall
    quad([(X0, ya, Z1), (X0, ya, Z0), (X0, yb, Z0), (X0, yb, Z1)], (1, 0, 0), color)      # left wall
    quad([(X1, ya, Z0), (X1, ya, Z1), (X1, yb, Z1), (X1, yb, Z0)], (-1, 0, 0), color)     # right wall

# Plinth for the object.
cx, cz = PLINTH_CENTER
side, top = srgb(0x2F3640), srgb(0x56606C)
for step in range(PLINTH_SEGMENTS):
    a0 = 2 * math.pi * step / PLINTH_SEGMENTS
    a1 = 2 * math.pi * (step + 1) / PLINTH_SEGMENTS
    mid = (a0 + a1) / 2
    p0 = (cx + PLINTH_RADIUS * math.cos(a0), cz + PLINTH_RADIUS * math.sin(a0))
    p1 = (cx + PLINTH_RADIUS * math.cos(a1), cz + PLINTH_RADIUS * math.sin(a1))
    quad([(p1[0], 0, p1[1]), (p0[0], 0, p0[1]), (p0[0], PLINTH_HEIGHT, p0[1]), (p1[0], PLINTH_HEIGHT, p1[1])],
         (math.cos(mid), 0, math.sin(mid)), side)
    base = len(positions)
    for point in ((cx, PLINTH_HEIGHT, cz), (p1[0], PLINTH_HEIGHT, p1[1]), (p0[0], PLINTH_HEIGHT, p0[1])):
        positions.append(point)
        normals.append((0, 1, 0))
        colors.append(top)
    indices.extend([base, base + 1, base + 2])

vertex_count = len(positions)
assert vertex_count < 65535


def pack(values, fmt):
    return b"".join(struct.pack(fmt, *value) if isinstance(value, tuple) else struct.pack(fmt, value) for value in values)


position_bytes = pack(positions, "<3f")
normal_bytes = pack(normals, "<3f")
color_bytes = pack(colors, "<3f")
index_bytes = pack(indices, "<H")
index_bytes += b"\x00" * (-len(index_bytes) % 4)
binary = position_bytes + normal_bytes + color_bytes + index_bytes

lows = [min(p[axis] for p in positions) for axis in range(3)]
highs = [max(p[axis] for p in positions) for axis in range(3)]
document = {
    "asset": {"version": "2.0", "generator": "tools/make_room_glb.py"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"name": "KlaslokaalShell", "mesh": 0}],
    "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "indices": 3, "material": 0}]}],
    "materials": [{"name": "RoomFlat", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.95}}],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": vertex_count, "type": "VEC3", "min": lows, "max": highs},
        {"bufferView": 1, "componentType": 5126, "count": vertex_count, "type": "VEC3"},
        {"bufferView": 2, "componentType": 5126, "count": vertex_count, "type": "VEC3"},
        {"bufferView": 3, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
    ],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(position_bytes), "target": 34962},
        {"buffer": 0, "byteOffset": len(position_bytes), "byteLength": len(normal_bytes), "target": 34962},
        {"buffer": 0, "byteOffset": len(position_bytes) + len(normal_bytes), "byteLength": len(color_bytes), "target": 34962},
        {"buffer": 0, "byteOffset": len(position_bytes) + len(normal_bytes) + len(color_bytes), "byteLength": len(index_bytes), "target": 34963},
    ],
    "buffers": [{"byteLength": len(binary)}],
}
json_bytes = json.dumps(document, separators=(",", ":")).encode()
json_bytes += b" " * (-len(json_bytes) % 4)
glb = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(json_bytes) + 8 + len(binary))
glb += struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
glb += struct.pack("<I4s", len(binary), b"BIN\x00") + binary

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "wb") as handle:
    handle.write(glb)
print(f"wrote {os.path.relpath(OUT)}: {len(glb)} bytes, {len(indices) // 3} triangles, {vertex_count} vertices, 1 draw call")
