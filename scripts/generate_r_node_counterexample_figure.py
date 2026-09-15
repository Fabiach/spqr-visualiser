from math import atan2, cos, pi, sin
from pathlib import Path

from reportlab.graphics import renderPDF, renderSVG
from reportlab.graphics.shapes import Circle, Drawing, Line, Path as RlPath, Polygon, Rect, String
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "r-node-pole-opening-counterexample"

pdfmetrics.registerFont(TTFont("ThesisSerif", r"C:\Windows\Fonts\times.ttf"))
pdfmetrics.registerFont(TTFont("ThesisSerifItalic", r"C:\Windows\Fonts\timesi.ttf"))
pdfmetrics.registerFont(TTFont("ThesisSerifBold", r"C:\Windows\Fonts\timesbd.ttf"))

WHITE = HexColor("#ffffff")
INK = HexColor("#252a30")
TEXT = HexColor("#20242a")
MUTED = HexColor("#555e68")
EDGE = HexColor("#6f7780")
FAINT_EDGE = HexColor("#a7afb8")
REGION_FILL = HexColor("#f6f7f9")
REGION_STROKE = HexColor("#b7bec7")
PROXY_FILL = HexColor("#eaf2f8")
PROXY_STROKE = HexColor("#6083a3")
MOVEMENT = HexColor("#8a949f")
TARGET = HexColor("#aab2bb")
SEPARATOR = HexColor("#d8dde3")
RED = HexColor("#b43a48")
BLUE = HexColor("#216b9b")

P1 = (60, 455)
P2 = (420, 455)
TEMP1 = (150, 285)
TEMP2 = (330, 285)
ZOUT = (240, 115)
B = (230.22, 244.35)
C = (228.26, 270.22)
D = (202.83, 266.52)
BEND = (157.20, 281.35)


def shifted(point, offset):
    # The construction coordinates use the SVG convention (y grows downward),
    # while ReportLab uses the mathematical convention (y grows upward).
    return point[0] + offset, 610 - point[1]


def add_path(drawing, points, color=EDGE, width=2.25, dash=None):
    path = RlPath()
    path.moveTo(*points[0])
    for point in points[1:]:
        path.lineTo(*point)
    path.fillColor = None
    path.strokeColor = color
    path.strokeWidth = width
    path.strokeLineCap = 1
    path.strokeLineJoin = 1
    if dash:
        path.strokeDashArray = dash
    drawing.add(path)


def add_arrow(drawing, start, end):
    add_path(drawing, [start, end], MOVEMENT, 1.7, [7, 6])
    angle = atan2(end[1] - start[1], end[0] - start[0])
    length = 10
    half = 4.5
    base_x = end[0] - length * cos(angle)
    base_y = end[1] - length * sin(angle)
    normal_x = -sin(angle)
    normal_y = cos(angle)
    drawing.add(Polygon([
        end[0], end[1],
        base_x + half * normal_x, base_y + half * normal_y,
        base_x - half * normal_x, base_y - half * normal_y,
    ], fillColor=MOVEMENT, strokeColor=None))


def add_text(drawing, x, y, text, size=20, color=TEXT, font="ThesisSerif", anchor="start"):
    drawing.add(String(
        x, y, text,
        fontName=font,
        fontSize=size,
        fillColor=color,
        textAnchor=anchor,
    ))


def add_math_subscript(drawing, x, y, base, sub, size=20, color=TEXT, anchor="start"):
    base_width = pdfmetrics.stringWidth(base, "ThesisSerifItalic", size)
    total_width = base_width + pdfmetrics.stringWidth(sub, "ThesisSerif", size * 0.62)
    start_x = x
    if anchor == "middle":
        start_x -= total_width / 2
    elif anchor == "end":
        start_x -= total_width
    add_text(drawing, start_x, y, base, size, color, "ThesisSerifItalic")
    add_text(drawing, start_x + base_width, y - size * 0.22, sub, size * 0.62, color)


def add_temp_label(drawing, x, y, pole_number, anchor="start"):
    size = 17
    base = "temp"
    sub = f"p{pole_number}"
    base_width = pdfmetrics.stringWidth(base, "ThesisSerifItalic", size)
    sub_width = pdfmetrics.stringWidth(sub, "ThesisSerif", 11)
    start_x = x
    if anchor == "end":
        start_x -= base_width + sub_width
    elif anchor == "middle":
        start_x -= (base_width + sub_width) / 2
    add_text(drawing, start_x, y, base, size, MUTED, "ThesisSerifItalic")
    add_text(drawing, start_x + base_width, y - 3.5, sub, 11, MUTED)


def add_region(drawing, offset):
    region = [shifted(point, offset) for point in [P1, ZOUT, P2, (240, 285)]]
    proxy = [shifted(point, offset) for point in [TEMP1, ZOUT, TEMP2]]
    drawing.add(Polygon(
        [coordinate for point in region for coordinate in point],
        fillColor=REGION_FILL,
        strokeColor=REGION_STROKE,
        strokeWidth=1.8,
        strokeLineJoin=1,
    ))
    drawing.add(Polygon(
        [coordinate for point in proxy for coordinate in point],
        fillColor=PROXY_FILL,
        strokeColor=PROXY_STROKE,
        strokeWidth=1.8,
        strokeDashArray=[7, 6],
        strokeLineJoin=1,
    ))


def add_fixed_edges(
    drawing,
    offset,
    crossing_color=None,
    base_color=EDGE,
    base_width=2.25,
    focus_color=INK,
    focus_width=2.8,
):
    add_path(drawing, [shifted(ZOUT, offset), shifted(B, offset)], base_color, base_width)
    add_path(drawing, [shifted(B, offset), shifted(C, offset)], base_color, base_width)
    add_path(drawing, [shifted(B, offset), shifted(D, offset)], base_color, base_width)
    add_path(
        drawing,
        [shifted(C, offset), shifted(D, offset)],
        crossing_color or focus_color,
        3.5 if crossing_color else focus_width,
    )


def add_inner_nodes(drawing, offset, include_labels=True):
    for point in [ZOUT, B, C, D]:
        x, y = shifted(point, offset)
        drawing.add(Circle(x, y, 6.5, fillColor=WHITE, strokeColor=INK, strokeWidth=2))
    if not include_labels:
        return
    add_math_subscript(drawing, offset + 249, 505, "z′", "out", 20)
    add_text(drawing, offset + 239, 377, "b", 20, TEXT, "ThesisSerifItalic")
    add_text(drawing, offset + 238, 318, "c", 20, TEXT, "ThesisSerifItalic")
    add_text(drawing, offset + 183, 321, "d", 20, TEXT, "ThesisSerifItalic")


def add_pole(drawing, point, offset, temporary=False, target=False):
    x, y = shifted(point, offset)
    if target:
        drawing.add(Circle(x, y, 7.5, fillColor=WHITE, strokeColor=TARGET, strokeWidth=1.7))
    elif temporary:
        drawing.add(Circle(
            x, y, 6.5,
            fillColor=WHITE,
            strokeColor=PROXY_STROKE,
            strokeWidth=2,
            strokeDashArray=[4, 3],
        ))
    else:
        drawing.add(Circle(x, y, 7.5, fillColor=BLUE, strokeColor=WHITE, strokeWidth=2.2))


def add_panel_header(drawing, offset, title):
    add_text(drawing, offset + 240, 571, title, 24, TEXT, "ThesisSerifBold", "middle")


def add_panel_note(drawing, offset, note):
    add_text(drawing, offset + 240, 58, note, 19, MUTED, "ThesisSerif", "middle")


def panel_proxy(drawing, offset):
   # add_panel_header(drawing, offset, "(a)  Proxy Tutte drawing")
    add_region(drawing, offset)
    add_arrow(drawing, shifted((144, 293), offset), shifted((67, 444), offset))
    add_arrow(drawing, shifted((336, 293), offset), shifted((413, 444), offset))

    add_path(drawing, [shifted(TEMP1, offset), shifted(ZOUT, offset)])
    add_path(drawing, [shifted(TEMP2, offset), shifted(ZOUT, offset)])
    add_path(drawing, [shifted(TEMP1, offset), shifted(B, offset)], INK, 2.8)
    add_path(drawing, [shifted(TEMP2, offset), shifted(B, offset)])
    add_path(drawing, [shifted(TEMP1, offset), shifted(C, offset)])
    add_path(drawing, [shifted(TEMP2, offset), shifted(C, offset)])
    add_path(drawing, [shifted(TEMP1, offset), shifted(D, offset)])
    add_fixed_edges(drawing, offset)

    add_pole(drawing, P1, offset, target=True)
    add_pole(drawing, P2, offset, target=True)
    add_pole(drawing, TEMP1, offset)
    add_pole(drawing, TEMP2, offset)
    add_inner_nodes(drawing, offset, include_labels=False)
    add_math_subscript(drawing, offset + 249, 505, "z′", "out", 20)
    zin_x, zin_y = shifted((240, 285), offset)
    drawing.add(Polygon([
        zin_x, zin_y + 4,
        zin_x + 4, zin_y,
        zin_x, zin_y - 4,
        zin_x - 4, zin_y,
    ], fillColor=WHITE, strokeColor=PROXY_STROKE, strokeWidth=1.5))
    add_math_subscript(drawing, offset + 252, 302, "z", "in", 17, MUTED)

    add_temp_label(drawing, offset + 139, 298, 1, "end")
    add_temp_label(drawing, offset + 341, 298, 2)
    add_math_subscript(drawing, offset + 47, 128, "p", "1", 17, MUTED)
    add_math_subscript(drawing, offset + 414, 128, "p", "2", 17, MUTED)
  #  add_panel_note(drawing, offset, "Planar inside the convex proxy triangle")


def panel_crossing(drawing, offset, detailed_labels=False):
  #  add_panel_header(drawing, offset, "(b)  Straight reconnection")
    add_region(drawing, offset)
    add_arrow(drawing, shifted((144, 293), offset), shifted((67, 444), offset))
    add_arrow(drawing, shifted((336, 293), offset), shifted((413, 444), offset))

    add_path(drawing, [shifted(P1, offset), shifted(ZOUT, offset)], FAINT_EDGE, 1.7)
    add_path(drawing, [shifted(P2, offset), shifted(ZOUT, offset)], FAINT_EDGE, 1.7)
    add_path(drawing, [shifted(P1, offset), shifted(B, offset)], RED, 3.5)
    add_path(drawing, [shifted(P2, offset), shifted(B, offset)], FAINT_EDGE, 1.7)
    add_path(drawing, [shifted(P1, offset), shifted(C, offset)], FAINT_EDGE, 1.7)
    add_path(drawing, [shifted(P2, offset), shifted(C, offset)], FAINT_EDGE, 1.7)
    add_path(drawing, [shifted(P1, offset), shifted(D, offset)], FAINT_EDGE, 1.7)
    add_fixed_edges(
        drawing,
        offset,
        crossing_color=RED,
        base_color=FAINT_EDGE,
        base_width=1.7,
    )

    add_pole(drawing, TEMP1, offset, temporary=True)
    add_pole(drawing, TEMP2, offset, temporary=True)
    add_pole(drawing, P1, offset)
    add_pole(drawing, P2, offset)
    add_inner_nodes(drawing, offset, include_labels=detailed_labels)
    if not detailed_labels:
        add_math_subscript(drawing, offset + 249, 505, "z′", "out", 20)

    add_temp_label(drawing, offset + 139, 298, 1, "end")
    add_temp_label(drawing, offset + 341, 298, 2)
    add_math_subscript(drawing, offset + 42, 128, "p", "1", 20)
    add_math_subscript(drawing, offset + 414, 128, "p", "2", 20)

   # add_panel_note(drawing, offset, "A pole edge crosses a fixed interior edge")


def panel_repair(drawing, offset):
    #add_panel_header(drawing, offset, "(c)  Local repair")
    add_region(drawing, offset)
    add_arrow(drawing, shifted((144, 293), offset), shifted((67, 444), offset))
    add_arrow(drawing, shifted((336, 293), offset), shifted((413, 444), offset))

    add_path(drawing, [shifted(P1, offset), shifted(ZOUT, offset)])
    add_path(drawing, [shifted(P2, offset), shifted(ZOUT, offset)])
    add_path(drawing, [shifted(P1, offset), shifted(BEND, offset), shifted(B, offset)], BLUE, 3.6)
    add_path(drawing, [shifted(P2, offset), shifted(B, offset)])
    add_path(drawing, [shifted(P1, offset), shifted(C, offset)])
    add_path(drawing, [shifted(P2, offset), shifted(C, offset)])
    add_path(drawing, [shifted(P1, offset), shifted(D, offset)])
    add_fixed_edges(drawing, offset)

    add_pole(drawing, TEMP1, offset, temporary=True)
    add_pole(drawing, TEMP2, offset, temporary=True)
    add_pole(drawing, P1, offset)
    add_pole(drawing, P2, offset)
    add_inner_nodes(drawing, offset)
    x, y = shifted(BEND, offset)
    drawing.add(Circle(x, y, 5.8, fillColor=WHITE, strokeColor=BLUE, strokeWidth=3))

    add_temp_label(drawing, offset + 139, 298, 1, "end")
    add_temp_label(drawing, offset + 341, 298, 2)
    add_math_subscript(drawing, offset + 42, 128, "p", "1", 20)
    add_math_subscript(drawing, offset + 414, 128, "p", "2", 20)
    add_path(drawing, [shifted((104, 223), offset), shifted((132, 248), offset), shifted((154, 275), offset)], MUTED, 1.4)
    add_text(drawing, offset + 99, 392, "local bend", 17, MUTED, "ThesisSerifItalic", "middle")
  #  add_panel_note(drawing, offset, "Only the affected pole edge is rerouted")


def build_figure():
    drawing = Drawing(1600, 610)
    drawing.add(Rect(0, 0, 1600, 610, fillColor=WHITE, strokeColor=None))
    drawing.add(Line(535, 40, 535, 578, strokeColor=SEPARATOR, strokeWidth=1.4))
    drawing.add(Line(1065, 40, 1065, 578, strokeColor=SEPARATOR, strokeWidth=1.4))
    panel_proxy(drawing, 20)
    panel_crossing(drawing, 550)
    panel_repair(drawing, 1080)
    return drawing


def build_panel(panel_drawer):
    drawing = Drawing(500, 610)
    drawing.add(Rect(0, 0, 500, 610, fillColor=WHITE, strokeColor=None))
    panel_drawer(drawing, 0)
    return drawing


if __name__ == "__main__":
    figure = build_figure()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    renderSVG.drawToFile(figure, str(OUTPUT.with_suffix(".svg")))
    renderPDF.drawToFile(figure, str(OUTPUT.with_suffix(".pdf")))

    separate_panels = [
        (
            "r-node-pole-opening-a-proxy-tutte.svg",
            build_panel(panel_proxy),
        ),
        (
            "r-node-pole-opening-b-straight-crossing.svg",
            build_panel(lambda drawing, offset: panel_crossing(
                drawing, offset, detailed_labels=True
            )),
        ),
        (
            "r-node-pole-opening-c-local-repair.svg",
            build_panel(panel_repair),
        ),
    ]
    for filename, panel in separate_panels:
        panel_output = OUTPUT.parent / filename
        renderSVG.drawToFile(panel, str(panel_output))
        renderPDF.drawToFile(panel, str(panel_output.with_suffix(".pdf")))
