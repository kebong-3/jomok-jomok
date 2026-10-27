"""Render USER-GUIDE.md as a four-page Korean PDF. No application build needed."""
from pathlib import Path
import re
import html

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
FONT = ROOT / 'node_modules/pretendard-gov/dist/public/static/alternative'
pdfmetrics.registerFont(TTFont('Pretendard', str(FONT / 'PretendardGOV-Regular.ttf')))
pdfmetrics.registerFont(TTFont('Pretendard-Bold', str(FONT / 'PretendardGOV-Bold.ttf')))
pdfmetrics.registerFont(TTFont('Mono', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))
pdfmetrics.registerFontFamily('Pretendard', normal='Pretendard', bold='Pretendard-Bold', italic='Pretendard', boldItalic='Pretendard-Bold')

INK = colors.HexColor('#17233A')
MUTED = colors.HexColor('#56657A')
BLUE = colors.HexColor('#1650C9')
LINE = colors.HexColor('#D8E0EB')
SOFT = colors.HexColor('#EDF3FE')
WIDTH, HEIGHT = A4
MARGIN = 43
CONTENT_WIDTH = WIDTH - MARGIN * 2

styles = {
    'body': ParagraphStyle('body', fontName='Pretendard', fontSize=10.1, leading=15.7, textColor=INK, spaceAfter=7, wordWrap='CJK', alignment=TA_LEFT),
    'title': ParagraphStyle('title', fontName='Pretendard-Bold', fontSize=23, leading=29, textColor=INK, spaceAfter=10, wordWrap='CJK', keepWithNext=True),
    'h2': ParagraphStyle('h2', fontName='Pretendard-Bold', fontSize=12.8, leading=19, textColor=BLUE, spaceBefore=9, spaceAfter=5, wordWrap='CJK', keepWithNext=True),
    'table': ParagraphStyle('table', fontName='Pretendard', fontSize=9.2, leading=13.6, textColor=INK, wordWrap='CJK'),
    'tablehead': ParagraphStyle('tablehead', fontName='Pretendard-Bold', fontSize=9.2, leading=13.6, textColor=BLUE, wordWrap='CJK'),
    'envnames': ParagraphStyle('envnames', fontName='Pretendard', fontSize=9.2, leading=13.6, textColor=INK, splitLongWords=False),
    'code': ParagraphStyle('code', fontName='Mono', fontSize=9, leading=13.4, textColor=INK, spaceAfter=0),
    'source': ParagraphStyle('source', fontName='Pretendard', fontSize=7.7, leading=11, textColor=MUTED, wordWrap='CJK', spaceAfter=5),
}

def inline(text):
    escaped = html.escape(text, quote=False)
    escaped = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', escaped)
    escaped = re.sub(r'`([^`]+)`', r'<font color="#304B74">\1</font>', escaped)
    return escaped

def para(text, style='body'):
    return Paragraph(inline(text), styles[style])

def draw_frame(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BLUE)
    canvas.rect(MARGIN, HEIGHT - 29, 22, 4, fill=1, stroke=0)
    canvas.setFont('Pretendard-Bold', 8.5)
    canvas.drawString(MARGIN + 30, HEIGHT - 29, '조목조목  /  사용 안내')
    canvas.setFont('Pretendard', 8)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(WIDTH - MARGIN, HEIGHT - 29, 'v0.3.0')
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN, 37, WIDTH - MARGIN, 37)
    canvas.setFont('Pretendard', 7.7)
    canvas.drawString(MARGIN, 23, '원문 확인 · 담당자 판단 · 근거와 작업 보관')
    canvas.drawRightString(WIDTH - MARGIN, 23, f'{doc.page} / 4')
    canvas.restoreState()

story = []
lines = (DOCS / 'USER-GUIDE.md').read_text(encoding='utf-8').splitlines()
i = 0
while i < len(lines):
    line = lines[i].strip()
    if not line:
        i += 1
        continue
    if line == '<!-- pagebreak -->':
        story.append(PageBreak())
        i += 1
        continue
    if line.startswith('# '):
        story.append(para(line[2:], 'title'))
        i += 1
        continue
    if line.startswith('## '):
        story.append(para(line[3:], 'h2'))
        i += 1
        continue
    if line.startswith('```'):
        code = []
        i += 1
        while i < len(lines) and not lines[i].startswith('```'):
            # Comment text is Korean, so render it with the embedded Korean font.
            content = lines[i]
            code.append(Paragraph(html.escape(content), styles['table' if content.startswith('#') else 'code']))
            i += 1
        box = Table([[cell] for cell in code], colWidths=[CONTENT_WIDTH])
        box.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F3F6FA')), ('LEFTPADDING', (0, 0), (-1, -1), 13), ('RIGHTPADDING', (0, 0), (-1, -1), 13), ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 1), ('TOPPADDING', (0, 0), (-1, 0), 9), ('BOTTOMPADDING', (0, -1), (-1, -1), 9)]))
        story.extend([KeepTogether([box]), Spacer(1, 9)])
        i += 1
        continue
    if line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            cells = [cell.strip() for cell in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r'[-:]+', cell) for cell in cells):
                rows.append(cells)
            i += 1
        environment = rows[0][0] == '변수 이름'
        widths = [CONTENT_WIDTH * (0.51 if environment else 0.25), CONTENT_WIDTH * (0.49 if environment else 0.75)]
        table = Table([[para(cell, 'tablehead' if index == 0 else 'envnames' if environment and column == 0 else 'table') for column, cell in enumerate(row)] for index, row in enumerate(rows)], colWidths=widths, hAlign='LEFT')
        table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), SOFT), ('LINEBELOW', (0, 0), (-1, 0), 0.7, LINE), ('LINEBELOW', (0, 1), (-1, -1), 0.4, LINE), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9), ('TOPPADDING', (0, 0), (-1, -1), 5 if environment else 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 5 if environment else 7)]))
        story.extend([KeepTogether([table]), Spacer(1, 10)])
        continue
    paragraph = line
    i += 1
    while i < len(lines) and lines[i].strip() and not lines[i].startswith(('#', '|', '```', '<!--')) and not re.match(r'\d+\.', lines[i]):
        paragraph += ' ' + lines[i].strip()
        i += 1
    story.append(para(paragraph, 'source' if paragraph.startswith('**구현 근거:') else 'body'))

document = SimpleDocTemplate(str(DOCS / 'JOMOKJOMOK-GUIDE-v0.3.pdf'), pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN, topMargin=56, bottomMargin=52,
    title='조목조목 v0.3 사용 안내', author='조목조목', subject='입력 검토, 상위법 영향, 문서와 작업 보관, 사용 기록 및 설치')
document.build(story, onFirstPage=draw_frame, onLaterPages=draw_frame)
print(DOCS / 'JOMOKJOMOK-GUIDE-v0.3.pdf')
