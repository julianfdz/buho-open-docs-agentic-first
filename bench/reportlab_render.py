"""
La forma «de siempre»: un script de Python con reportlab que convierte el mismo Markdown en un PDF con
el estilo Búho (portada, cabecera y pie, Georgia + Calibri, tablas navy, cajas y tarjetas).
Cada cambio obliga a volver a ejecutarlo entero. Lo usa bench/velocidad.mjs como referencia.

    python bench/reportlab_render.py entrada.md salida.pdf
"""
import re
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (KeepTogether, ListFlowable, ListItem, PageBreak, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

NAVY = colors.HexColor('#0A1F3A')
TURQ = colors.HexColor('#00C1B8')
TURQ_L = colors.HexColor('#E4F7F6')
AZUL_L = colors.HexColor('#EDF1F7')
GRIS = colors.HexColor('#5D6B7C')

FONTS = r'C:\Windows\Fonts'
for name, file in [('Georgia', 'georgia.ttf'), ('Georgia-Bold', 'georgiab.ttf'), ('Calibri', 'calibri.ttf'),
                   ('Calibri-Bold', 'calibrib.ttf'), ('Calibri-Italic', 'calibrii.ttf'), ('Calibri-BoldItalic', 'calibriz.ttf')]:
    pdfmetrics.registerFont(TTFont(name, f'{FONTS}\\{file}'))
pdfmetrics.registerFontFamily('Calibri', normal='Calibri', bold='Calibri-Bold', italic='Calibri-Italic', boldItalic='Calibri-BoldItalic')

ST = {
    'p': ParagraphStyle('p', fontName='Calibri', fontSize=10.5, leading=15, textColor=colors.HexColor('#1C2A3B'), spaceAfter=6),
    'h2': ParagraphStyle('h2', fontName='Georgia-Bold', fontSize=15.5, leading=19, textColor=NAVY, spaceBefore=12, spaceAfter=5),
    'h3': ParagraphStyle('h3', fontName='Calibri-Bold', fontSize=11.5, leading=14, textColor=NAVY, spaceAfter=3),
    'th': ParagraphStyle('th', fontName='Calibri-Bold', fontSize=8.5, leading=11, textColor=colors.white),
    'td': ParagraphStyle('td', fontName='Calibri', fontSize=9.5, leading=12.5),
    'title': ParagraphStyle('title', fontName='Georgia-Bold', fontSize=30, leading=35, textColor=NAVY, spaceAfter=14),
    'sub': ParagraphStyle('sub', fontName='Calibri', fontSize=12.5, leading=17, spaceAfter=20),
    'kicker': ParagraphStyle('kicker', fontName='Calibri-Bold', fontSize=8.5, textColor=TURQ, spaceAfter=10),
}


def inline(t):
    t = t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'\*(.+?)\*', r'<i>\1</i>', t)
    t = re.sub(r'\s*\{[^{}]*\}\s*$', '', t)
    return t


def front(src):
    meta, body = {}, src
    m = re.match(r'^---\n(.*?)\n---\n', src, re.S)
    if m:
        for line in m.group(1).splitlines():
            k, _, v = line.partition(':')
            meta[k.strip()] = v.strip().strip('"')
        body = src[m.end():]
    return meta, body


def table(rows):
    data = [[Paragraph(inline(c), ST['th'] if i == 0 else ST['td']) for c in r] for i, r in enumerate(rows)]
    t = Table(data, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F6F9FB')]),
        ('LINEBELOW', (0, 1), (-1, -1), 0.5, colors.HexColor('#DFE5EC')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return t


def box(flow, bg):
    t = Table([[flow]], colWidths=[174 * mm])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), bg), ('LINEBEFORE', (0, 0), (0, -1), 3, TURQ),
                           ('LEFTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]))
    return t


def cards(lines):
    cells, cur = [], None
    for l in lines:
        if l.startswith('### '):
            cur = [Paragraph(inline(l[4:]), ST['h3'])]
            cells.append(cur)
        elif l.strip() and cur is not None:
            cur.append(Paragraph(inline(l), ST['td']))
    n = 3
    rows = [cells[i:i + n] + [[]] * (n - len(cells[i:i + n])) for i in range(0, len(cells), n)]
    t = Table(rows, colWidths=[58 * mm] * n)
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), TURQ_L), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                           ('BOX', (0, 0), (-1, -1), 4, colors.white), ('INNERGRID', (0, 0), (-1, -1), 4, colors.white),
                           ('TOPPADDING', (0, 0), (-1, -1), 8), ('LEFTPADDING', (0, 0), (-1, -1), 8)]))
    return t


def build(body):
    out, lines, i, para, lst = [], body.splitlines(), 0, [], []

    def flush():
        nonlocal para, lst
        if para:
            out.append(Paragraph(inline(' '.join(para)), ST['p']))
            para = []
        if lst:
            out.append(ListFlowable([ListItem(Paragraph(inline(x), ST['p'])) for x in lst], bulletType='bullet', bulletColor=TURQ, leftIndent=12))
            lst = []

    while i < len(lines):
        l = lines[i]
        if l.startswith('## '):
            flush()
            out.append(Paragraph(inline(l[3:]), ST['h2']))
        elif l.startswith('### '):
            flush()
            out.append(Paragraph(inline(l[4:]), ST['h3']))
        elif l.startswith('- '):
            if para:
                flush()
            lst.append(l[2:])
        elif l.startswith('|'):
            flush()
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                if not re.match(r'^\|[-|\s]+\|$', lines[i]):
                    rows.append([c.strip() for c in lines[i].strip('|').split('|')])
                i += 1
            out.append(table(rows))
            out.append(Spacer(1, 6))
            continue
        elif l.startswith(':::') and l.strip() != ':::':
            flush()
            kind = l[3:].split()[0]
            inner = []
            i += 1
            while i < len(lines) and lines[i].strip() != ':::':
                inner.append(lines[i])
                i += 1
            if kind == 'tarjetas':
                out.append(cards(inner))
            else:
                out.append(box(Paragraph(inline(' '.join(x for x in inner if x.strip())), ST['p']), TURQ_L if kind != 'nota' else AZUL_L))
            out.append(Spacer(1, 8))
        elif l.strip() == '\\pagebreak':
            flush()
            out.append(PageBreak())
        elif not l.strip():
            flush()
        else:
            if lst:
                flush()
            para.append(l)
        i += 1
    flush()
    # Título con el bloque siguiente, como «conservar con el siguiente».
    res, k = [], 0
    while k < len(out):
        f = out[k]
        if isinstance(f, Paragraph) and f.style.name in ('h2', 'h3') and k + 1 < len(out):
            res.append(KeepTogether([f, out[k + 1]]))
            k += 2
        else:
            res.append(f)
            k += 1
    return res


def main(src_path, out_path):
    meta, body = front(open(src_path, encoding='utf-8').read())
    title = meta.get('titulo', '')

    def cover(c, d):
        c.saveState()
        c.setFillColor(TURQ)
        c.rect(0, A4[1] - 6, A4[0], 6, fill=1, stroke=0)
        c.setFillColor(NAVY)
        c.rect(0, 0, A4[0], 8, fill=1, stroke=0)
        c.restoreState()

    def page(c, d):
        c.saveState()
        c.setFillColor(TURQ)
        c.rect(0, A4[1] - 4.5, A4[0], 4.5, fill=1, stroke=0)
        c.setFont('Georgia-Bold', 10)
        c.setFillColor(NAVY)
        c.drawString(18 * mm, A4[1] - 15 * mm, 'BÚHO AI')
        c.setFont('Calibri', 8)
        c.setFillColor(TURQ)
        c.drawRightString(A4[0] - 18 * mm, A4[1] - 15 * mm, title)
        c.setFillColor(GRIS)
        c.setFont('Calibri', 7.5)
        c.drawString(18 * mm, 12 * mm, 'Búho AI · Tu equipo técnico de IA · buhoai.es')
        c.drawRightString(A4[0] - 18 * mm, 12 * mm, f'{d.page}')
        c.restoreState()

    story = [Spacer(1, 70 * mm), Paragraph(inline(meta.get('etiqueta', '')), ST['kicker']), Paragraph(inline(title), ST['title']),
             Paragraph(inline(meta.get('subtitulo', '')), ST['sub']), PageBreak()] + build(body)
    doc = SimpleDocTemplate(out_path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=24 * mm, bottomMargin=22 * mm, title=title)
    doc.build(story, onFirstPage=cover, onLaterPages=page)
    print(doc.page)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
