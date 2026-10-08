"""Builds docs/JEC_Alumni_Connect_Plan.pdf. Run: python3 docs/build_plan_pdf.py"""
import os

from reportlab.graphics.shapes import Circle, Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, CondPageBreak, Frame, KeepTogether, NextPageTemplate, PageBreak,
    PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "JEC_Alumni_Connect_Plan.pdf")

FONT_DIR = "/usr/share/fonts/truetype/crosextra"
pdfmetrics.registerFont(TTFont("Body", f"{FONT_DIR}/Carlito-Regular.ttf"))
pdfmetrics.registerFont(TTFont("Body-Bold", f"{FONT_DIR}/Carlito-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Body-Italic", f"{FONT_DIR}/Carlito-Italic.ttf"))
pdfmetrics.registerFont(TTFont("Body-BoldItalic", f"{FONT_DIR}/Carlito-BoldItalic.ttf"))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold",
                              italic="Body-Italic", boldItalic="Body-BoldItalic")

# Brand colours (also the app's design tokens, see Section 05)
NAVY = colors.HexColor("#14306B")
NAVY_DARK = colors.HexColor("#0C1E45")
MARIGOLD = colors.HexColor("#F2A33A")
TEAL = colors.HexColor("#1F9D8B")
CORAL = colors.HexColor("#E5594F")
INK = colors.HexColor("#1D2433")
MUTED = colors.HexColor("#5B6475")
LINE = colors.HexColor("#DDE2EB")
SOFT = colors.HexColor("#F3F5F9")
TINT = colors.HexColor("#EAF0FB")
CREAM = colors.HexColor("#FFF6E8")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

# ---------------------------------------------------------------- styles
S = {
    "body": ParagraphStyle("body", fontName="Body", fontSize=10.5, leading=15, textColor=INK, spaceAfter=6),
    "small": ParagraphStyle("small", fontName="Body", fontSize=9, leading=12, textColor=MUTED),
    "cell": ParagraphStyle("cell", fontName="Body", fontSize=9.5, leading=12.5, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="Body-Bold", fontSize=9.5, leading=12.5, textColor=INK),
    "th": ParagraphStyle("th", fontName="Body-Bold", fontSize=9.5, leading=12, textColor=colors.white),
    "h1": ParagraphStyle("h1", fontName="Body-Bold", fontSize=22, leading=26, textColor=NAVY),
    "h2": ParagraphStyle("h2", fontName="Body-Bold", fontSize=13.5, leading=17, textColor=NAVY,
                         spaceBefore=10, spaceAfter=4),
    "h3": ParagraphStyle("h3", fontName="Body-Bold", fontSize=11, leading=14, textColor=INK,
                         spaceBefore=6, spaceAfter=2),
    "bullet": ParagraphStyle("bullet", fontName="Body", fontSize=10.5, leading=14.5, textColor=INK,
                             leftIndent=13, bulletIndent=2, spaceAfter=2.5),
    "callout": ParagraphStyle("callout", fontName="Body", fontSize=10.5, leading=15, textColor=INK),
    "lede": ParagraphStyle("lede", fontName="Body", fontSize=12, leading=17, textColor=MUTED, spaceAfter=8),
    "toc": ParagraphStyle("toc", fontName="Body", fontSize=11, leading=17, textColor=INK),
}


def P(text, style="body"):
    return Paragraph(text, S[style])


def bullets(items, style="bullet"):
    return [Paragraph(i, S[style], bulletText="•") for i in items]


def section(num, title, lede=None):
    badge = Table([[P(f"<font color='white'><b>{num:02d}</b></font>", "body")]],
                  colWidths=[11 * mm], rowHeights=[11 * mm])
    badge.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    head = Table([[badge, P(title, "h1")]], colWidths=[15 * mm, CONTENT_W - 15 * mm])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("LINEBELOW", (0, 0), (-1, -1), 2, MARIGOLD), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    out = [PageBreak(), head, Spacer(1, 8)]
    if lede:
        out.append(P(lede, "lede"))
    return out


def h2(text):
    return CondPageBreak(40 * mm), P(text, "h2")


def table(rows, widths, header=True, first_bold=False, zebra=True):
    data = []
    for r, row in enumerate(rows):
        cells = []
        for c, v in enumerate(row):
            if isinstance(v, str):
                st = "th" if header and r == 0 else ("cellb" if first_bold and c == 0 else "cell")
                v = P(v, st)
            cells.append(v)
        data.append(cells)
    t = Table(data, colWidths=[w * CONTENT_W for w in widths], repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), NAVY))
    if zebra:
        for i in range(1 if header else 0, len(data)):
            if i % 2 == 0:
                style.append(("BACKGROUND", (0, i), (-1, i), SOFT))
    t.setStyle(TableStyle(style))
    return t


def callout(text, bg=TINT, bar=NAVY):
    t = Table([[P(text, "callout")]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 3.5, bar),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return KeepTogether([Spacer(1, 4), t, Spacer(1, 8)])


def module(code, name, phase, summary, points):
    tag_color = {"Launch": TEAL, "V2": MARIGOLD, "V3": CORAL}[phase.split()[0]]
    head = Table([[P(f"<b>{code}</b>", "body"), P(f"<b>{name}</b>", "h3"),
                   P(f"<font color='white'><b>{phase}</b></font>", "small")]],
                 colWidths=[14 * mm, CONTENT_W - 14 * mm - 34 * mm, 34 * mm])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BACKGROUND", (2, 0), (2, 0), tag_color),
        ("ALIGN", (2, 0), (2, 0), "CENTER"), ("TEXTCOLOR", (0, 0), (0, 0), NAVY),
        ("LINEBELOW", (0, 0), (-1, -1), 0.8, LINE), ("LEFTPADDING", (0, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    body = [Spacer(1, 3), P(summary)] + bullets(points)
    return [CondPageBreak(45 * mm), head] + body + [Spacer(1, 6)]


# ---------------------------------------------------------------- wireframes
def phone(title, draw_body, label):
    w, h = 150, 290
    d = Drawing(w + 10, h + 26)
    d.add(Rect(5, 22, w, h, rx=16, ry=16, fillColor=colors.white, strokeColor=INK, strokeWidth=1.4))
    d.add(Rect(55, h + 12, 50, 4, rx=2, ry=2, fillColor=INK, strokeColor=None))
    d.add(Rect(11, h - 12, w - 12, 22, fillColor=NAVY, strokeColor=None))
    d.add(String(18, h - 4, title, fontName="Body-Bold", fontSize=9, fillColor=colors.white))
    # bottom tab bar
    d.add(Line(11, 52, w - 1, 52, strokeColor=LINE))
    for i, t in enumerate(["Home", "Network", "Groups", "Chat", "Me"]):
        x = 20 + i * 27
        d.add(Circle(x + 4, 42, 4, fillColor=LINE, strokeColor=None))
        d.add(String(x - 4, 29, t, fontName="Body", fontSize=5.5, fillColor=MUTED))
    draw_body(d, w, h)
    d.add(String(5, 4, label, fontName="Body-Bold", fontSize=8.5, fillColor=INK))
    k = (CONTENT_W / 4 - 6) / d.width  # fit four phones side by side
    d.scale(k, k)
    d.width, d.height = d.width * k, d.height * k
    return d


def bar(d, x, y, w, h=5, c=LINE):
    d.add(Rect(x, y, w, h, rx=2, ry=2, fillColor=c, strokeColor=None))


def btn(d, x, y, w, text, fill=NAVY, fg=colors.white):
    d.add(Rect(x, y, w, 15, rx=7, ry=7, fillColor=fill, strokeColor=None if fill != colors.white else NAVY))
    d.add(String(x + w / 2, y + 4.5, text, fontName="Body-Bold", fontSize=6.5, fillColor=fg, textAnchor="middle"))


def wf_onboarding(d, w, h):
    d.add(String(18, h - 30, "Step 3 of 4", fontName="Body", fontSize=6.5, fillColor=MUTED))
    bar(d, 18, h - 40, 124, 4)
    bar(d, 18, h - 40, 93, 4, MARIGOLD)
    d.add(String(18, h - 58, "What are you into?", fontName="Body-Bold", fontSize=10, fillColor=INK))
    chips = ["Travel", "Trekking", "Yoga", "Photography", "Cricket", "Startups", "Music", "Coding", "Fitness"]
    x, y = 18, h - 82
    for i, c in enumerate(chips):
        cw = 8 + len(c) * 4.2
        if x + cw > 142:
            x, y = 18, y - 19
        sel = i in (0, 2, 5)
        d.add(Rect(x, y, cw, 14, rx=7, ry=7, fillColor=TINT if sel else colors.white,
                   strokeColor=NAVY if sel else LINE))
        d.add(String(x + 4, y + 4, c, fontName="Body", fontSize=6.5, fillColor=NAVY if sel else MUTED))
        x += cw + 5
    btn(d, 18, 70, 124, "Continue")


def wf_profile(d, w, h):
    d.add(Rect(11, h - 52, w - 12, 40, fillColor=TINT, strokeColor=None))
    d.add(Circle(40, h - 58, 18, fillColor=colors.white, strokeColor=NAVY, strokeWidth=1.5))
    d.add(Rect(64, h - 70, 46, 11, rx=5, ry=5, fillColor=TEAL, strokeColor=None))
    d.add(String(68, h - 67, "Verified", fontName="Body-Bold", fontSize=6, fillColor=colors.white))
    d.add(String(18, h - 90, "Ananya Sharma", fontName="Body-Bold", fontSize=10, fillColor=INK))
    d.add(String(18, h - 101, "SDE II at Flipkart · Bengaluru", fontName="Body", fontSize=6.8, fillColor=MUTED))
    d.add(String(18, h - 111, "CSE · Batch 2016", fontName="Body", fontSize=6.8, fillColor=NAVY))
    btn(d, 18, h - 134, 58, "Message")
    btn(d, 82, h - 134, 58, "Connect", fill=colors.white, fg=NAVY)
    d.add(String(18, h - 152, "About", fontName="Body-Bold", fontSize=7.5, fillColor=INK))
    for i in range(3):
        bar(d, 18, h - 163 - i * 9, 124 - i * 22)
    d.add(String(18, h - 196, "Experience", fontName="Body-Bold", fontSize=7.5, fillColor=INK))
    for i in range(2):
        d.add(Rect(18, h - 220 - i * 22, 14, 14, rx=3, ry=3, fillColor=LINE, strokeColor=None))
        bar(d, 37, h - 211 - i * 22, 80)
        bar(d, 37, h - 219 - i * 22, 55, 4)


def wf_circles(d, w, h):
    tabs = [("Batch", True), ("Circles", False), ("Channels", False)]
    for i, (t, on) in enumerate(tabs):
        x = 18 + i * 42
        d.add(String(x, h - 32, t, fontName="Body-Bold" if on else "Body", fontSize=7.5,
                     fillColor=NAVY if on else MUTED))
        if on:
            bar(d, x, h - 37, 26, 2, MARIGOLD)
    cards = [("CSE 2016", "412 members · 38% on board"), ("Trekking Circle", "1.2k members"),
             ("Yoga Mornings", "640 members"), ("JEC Official", "Channel · broadcast")]
    for i, (t, s) in enumerate(cards):
        y = h - 72 - i * 44
        d.add(Rect(18, y, 124, 36, rx=6, ry=6, fillColor=SOFT, strokeColor=None))
        d.add(Circle(33, y + 18, 9, fillColor=[NAVY, TEAL, MARIGOLD, CORAL][i], strokeColor=None))
        d.add(String(48, y + 21, t, fontName="Body-Bold", fontSize=7.5, fillColor=INK))
        d.add(String(48, y + 11, s, fontName="Body", fontSize=6.2, fillColor=MUTED))


def wf_invite(d, w, h):
    d.add(String(18, h - 34, "Bring your batch in", fontName="Body-Bold", fontSize=10, fillColor=INK))
    d.add(String(18, h - 47, "CSE 2016 · 38% on board", fontName="Body", fontSize=6.8, fillColor=MUTED))
    bar(d, 18, h - 57, 124, 6)
    bar(d, 18, h - 57, 47, 6, TEAL)
    d.add(Rect(45, h - 140, 70, 70, fillColor=colors.white, strokeColor=INK))
    for i in range(6):
        for j in range(6):
            if (i * 7 + j * 3) % 4 < 2:
                d.add(Rect(50 + i * 10, h - 135 + j * 10, 8, 8, fillColor=INK, strokeColor=None))
    btn(d, 18, h - 168, 124, "Share on WhatsApp", fill=TEAL)
    btn(d, 18, h - 189, 124, "Copy invite link", fill=colors.white, fg=NAVY)
    d.add(String(18, h - 210, "Your badges", fontName="Body-Bold", fontSize=7.5, fillColor=INK))
    for i, c in enumerate([MARIGOLD, NAVY, LINE]):
        d.add(Circle(28 + i * 24, h - 226, 9, fillColor=c, strokeColor=None))


def wireframe_row():
    row = [phone("Sign up", wf_onboarding, "1. Interest picker"),
           phone("Profile", wf_profile, "2. Member profile"),
           phone("Communities", wf_circles, "3. Batch, circles, channels"),
           phone("Invite", wf_invite, "4. Invite & grow")]
    t = Table([row], colWidths=[CONTENT_W / 4] * 4)
    t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return t


def swatches():
    items = [(NAVY, "JEC Navy", "#14306B", "Primary, headers, buttons"),
             (MARIGOLD, "Marigold", "#F2A33A", "Highlights, badges, progress"),
             (TEAL, "Teal", "#1F9D8B", "Success, verified, share"),
             (CORAL, "Coral", "#E5594F", "Errors, alerts, live"),
             (INK, "Ink", "#1D2433", "Body text"),
             (SOFT, "Mist", "#F3F5F9", "Cards, backgrounds")]
    cells = []
    for c, name, hexv, use in items:
        d = Drawing(26, 26)
        d.add(Rect(0, 0, 26, 26, rx=5, ry=5, fillColor=c, strokeColor=LINE))
        cells.append([d, P(f"<b>{name}</b> {hexv}<br/><font color='#5B6475'>{use}</font>", "cell")])
    rows = [cells[i] + cells[i + 1] + cells[i + 2] for i in range(0, 6, 3)]
    rows = [[x for pair in [cells[i], cells[i + 1], cells[i + 2]] for x in pair] for i in range(0, 6, 3)]
    t = Table(rows, colWidths=[10 * mm, CONTENT_W / 3 - 10 * mm] * 3)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return t


def architecture():
    w, h = CONTENT_W, 170
    d = Drawing(w, h)

    def box(x, y, bw, bh, title, sub, fill):
        d.add(Rect(x, y, bw, bh, rx=6, ry=6, fillColor=fill, strokeColor=None))
        d.add(String(x + bw / 2, y + bh - 16, title, fontName="Body-Bold", fontSize=9.5,
                     fillColor=colors.white, textAnchor="middle"))
        for i, line in enumerate(sub):
            d.add(String(x + bw / 2, y + bh - 30 - i * 11, line, fontName="Body", fontSize=7.5,
                         fillColor=colors.white, textAnchor="middle"))

    def arrow(x1, y1, x2, y2):
        d.add(Line(x1, y1, x2, y2, strokeColor=MUTED, strokeWidth=1.2))

    cw = (w - 40) / 3
    box(0, 95, cw, 70, "Android app", ["Play Store (Trusted Web", "Activity wrapping the PWA)"], NAVY)
    box(cw + 20, 95, cw, 70, "Web app / PWA", ["React + Vite + TypeScript", "Installable on iPhone & PC"], NAVY)
    box(2 * cw + 40, 95, cw, 70, "Admin console", ["Same codebase,", "admin-only routes"], NAVY)
    box(0, 0, cw * 2 + 20, 70, "Supabase (free plan)",
        ["Postgres + Row Level Security · Auth (Google, email OTP)",
         "Storage (photos) · Realtime (chat) · Edge Functions"], TEAL)
    box(2 * cw + 40, 0, cw, 70, "Free add-ons", ["Firebase Cloud Messaging", "Brevo SMTP · Cloudflare"], MARIGOLD)
    for x in (cw / 2, cw * 1.5 + 20):
        arrow(x, 95, x, 70)
    arrow(2.5 * cw + 40, 95, 2.5 * cw + 40, 70)
    arrow(2.5 * cw + 40, 95, cw * 1.5 + 40, 70)
    return d


# ---------------------------------------------------------------- page decoration
def on_cover(c, doc):
    c.saveState()
    c.setFillColor(NAVY_DARK)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.circle(PAGE_W + 20, PAGE_H - 120, 260, stroke=0, fill=1)
    c.setFillColor(MARIGOLD)
    c.rect(MARGIN, PAGE_H - 250, 60, 5, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Body-Bold", 13)
    c.drawString(MARGIN, PAGE_H - 200, "JABALPUR ENGINEERING COLLEGE")
    c.setFont("Body-Bold", 44)
    c.drawString(MARGIN, PAGE_H - 300, "JEC Alumni Connect")
    c.setFont("Body", 17)
    c.setFillColor(colors.HexColor("#C9D4EA"))
    c.drawString(MARGIN, PAGE_H - 332, "One place for every JECian: profiles, batches, circles and messages.")
    c.setFont("Body", 13)
    c.drawString(MARGIN, PAGE_H - 380, "Product, design and implementation plan")
    c.setFillColor(MARIGOLD)
    c.setFont("Body-Bold", 13)
    c.drawString(MARGIN, PAGE_H - 400, "Version 2.0  ·  October 2026")
    c.setFillColor(colors.HexColor("#C9D4EA"))
    c.setFont("Body", 10.5)
    c.drawString(MARGIN, 70, "Prepared by the student development team for the JEC alumni committee.")
    c.drawString(MARGIN, 55, "For discussion. Not an official document of the college.")
    c.restoreState()


def on_page(c, doc):
    c.saveState()
    c.setStrokeColor(LINE)
    c.line(MARGIN, 14 * mm, PAGE_W - MARGIN, 14 * mm)
    c.setFont("Body", 8.5)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, 10 * mm, "JEC Alumni Connect · Plan v2.0")
    c.drawRightString(PAGE_W - MARGIN, 10 * mm, str(doc.page))
    c.restoreState()


# ---------------------------------------------------------------- content
def build():
    st = []
    st += [NextPageTemplate("main"), PageBreak()]

    # Contents
    st += [P("Contents", "h1"), Spacer(1, 6)]
    toc = ["Executive summary", "Why this app, and what success looks like", "Who it is for",
           "Feature map: 19 modules", "UI/UX: the make-or-break section", "Identity: sign-up, verification, profiles",
           "Connect: directory, search, connections, messages", "Community: feed, batches, circles, channels",
           "Grow and engage: invites, badges, birthdays", "Career, events and college pride",
           "Admin, privacy and safety", "Key user journeys", "Budget: running at almost ₹0",
           "Technical architecture", "Data model", "Screen list", "Release scope: Launch, V2, V3",
           "Roadmap: 14 weeks to launch", "Launch and growth plan", "Success metrics", "Team and roles",
           "Risks and how we handle them", "Decisions for the alumni committee", "Next steps"]
    rows = [[P(f"<font color='#14306B'><b>{i + 1:02d}</b></font>", "toc"), P(t, "toc")] for i, t in enumerate(toc)]
    t = Table(rows, colWidths=[14 * mm, CONTENT_W - 14 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
                           ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    st.append(t)

    # What's new
    st += [PageBreak(), P("What's new in version 2.0", "h1"), Spacer(1, 4),
           P("Version 1.1 added the zero budget, interest circles and channels, invites, engagement features and "
             "the UI/UX section. Version 2.0 keeps all of that and makes the plan ready to build.", "lede")]
    st.append(table([
        ["Area", "Upgrade in v2.0", "Section"],
        ["Networking", "New M8 Connections and follows (LinkedIn-style connect, Instagram-style follow) and "
                       "\"I can help with\" tags on every profile, so students find the right senior fast", "06, 07"],
        ["Messages", "Message requests for non-connections, daily limits and a \"who can message me\" setting, "
                     "so busy alumni are never flooded", "07"],
        ["Verification", "The three routes defined in detail: college records, two vouches, or a document "
                         "checked by a batch admin; read-only access while waiting", "06"],
        ["Journeys", "Step-by-step journeys with timings that prove the 3-minute sign-up target", "12"],
        ["Tech", "A concrete stack (React PWA + Supabase), an architecture diagram, engineering rules and "
                 "weekly backups", "14"],
        ["Free limits", "Real free-plan limits per service, email sending through Brevo, photo overflow to "
                        "Cloudflare R2, and the Supabase inactivity pause handled", "13"],
        ["Play Store", "Plans for Google's rule that new developer accounts must run a 14-day closed test "
                       "with 12 testers", "18"],
        ["Law", "Members 18+ at launch, a grievance contact, data download and deletion under the DPDP Act", "11"],
        ["Committee", "Every decision now has a \"needed by\" week, plus logo use, college records, admins, "
                      "guidelines and pilot batches", "23"],
        ["Continuity", "A handover plan so the app survives when the founding students graduate", "21"],
        ["Wireframes", "Four screens: interest picker, profile, communities and invite", "05"],
    ], [0.16, 0.72, 0.12], first_bold=True))

    # 01 Executive summary
    st += section(1, "Executive summary",
                  "JEC has thousands of alumni across India and the world, but no single place where they can find "
                  "each other, help students, or stay connected with their batch. JEC Alumni Connect is that place.")
    st.append(P("It combines three things people already know how to use:"))
    st += bullets([
        "<b>A professional profile, like LinkedIn:</b> where you studied at JEC, what you do now, where you work, "
        "and what you can help with.",
        "<b>Communities, like WhatsApp groups and Instagram:</b> every member automatically joins their batch "
        "(for example \"CSE 2016\"), can post publicly to all of JEC, and can join interest circles such as "
        "travel, trekking, yoga or startups.",
        "<b>Direct messages:</b> any verified student or alumnus can message any other, with limits that stop spam.",
    ])
    st += h2("What makes it work")
    st.append(table([
        ["Principle", "What it means in practice"],
        ["Trusted", "Only verified JECians get in. Three verification routes (Section 06)."],
        ["Never empty", "Launch batch by batch, with invites, progress bars and batch champions (Sections 09, 19)."],
        ["Fast and beautiful", "Sign up in under 3 minutes and message a batchmate within 5. A design lead approves "
                               "every screen (Section 05)."],
        ["Almost free", "Runs entirely on free plans. The only real cost is a one-time ₹2,100 Google Play fee "
                        "(Section 13)."],
        ["Safe", "Built for India's data protection law (DPDP Act 2023): consent, privacy controls, "
                 "block and report, account deletion (Section 11)."],
    ], [0.22, 0.78], first_bold=True))
    st += h2("At a glance")
    st.append(table([
        ["Item", "Plan"],
        ["Platforms", "Web app installable on any phone or PC (PWA), Android app on the Play Store, "
                      "iPhone via the installed web app in year one"],
        ["First launch", "11 modules: sign-up, verification, profiles, directory and search, connections, "
                         "messages, feed, batch groups, interest circles and channels, invites, engagement"],
        ["Time to launch", "About 14 weeks, starting with 3 weeks of design and user testing"],
        ["Team", "6 to 9 students, 1 design lead, 1 alumni advisor"],
        ["Running cost", "₹0 per month. One-time ₹2,100 for the Play Store (sponsorship requested)"],
    ], [0.22, 0.78], first_bold=True))

    # 02 Why
    st += section(2, "Why this app, and what success looks like")
    st += h2("The problem")
    st += bullets([
        "Alumni are spread across WhatsApp groups, LinkedIn and personal contacts. Most groups cover one batch or "
        "one branch, and many alumni are in none.",
        "Students have no easy way to find a senior at a particular company or city to ask for guidance, "
        "referrals or internships.",
        "The college has no up-to-date record of where its alumni are, which makes reunions, mentoring and "
        "placement support hard.",
        "Generic platforms (LinkedIn, Facebook) are noisy, are not limited to JECians, and cannot answer "
        "\"show me everyone from Mechanical 2010 in Pune\".",
    ])
    st += h2("The vision")
    st.append(callout("<b>Every JECian, one tap away.</b> A student in their first year can find a senior at the "
                      "company of their dreams and message them in under a minute. An alumnus who graduated in "
                      "1995 can find their whole batch, see what they are doing, and plan a reunion."))
    st += h2("Goals for the first year")
    st.append(table([
        ["Goal", "Target"],
        ["Verified members", "5,000 within 12 months of launch"],
        ["Batch coverage", "At least 30% of every batch from the last 20 years on board"],
        ["Activity", "30% of members active every month"],
        ["Sign-up speed", "Median sign-up under 3 minutes; first message within 5 minutes"],
        ["Help given", "500 student-to-alumni conversations about careers in the first year"],
        ["Cost", "₹0 per month in running costs"],
    ], [0.35, 0.65], first_bold=True))

    # 03 Users
    st += section(3, "Who it is for", "Four kinds of people use the app. Every feature should clearly help at least one.")
    st.append(table([
        ["Persona", "Who they are", "What they want", "What stops them today"],
        ["Riya, 2nd-year student", "ECE student, wants an internship in chip design",
         "Find seniors in semiconductor firms; ask for advice and referrals", "Doesn't know who works where; cold "
                                                                             "LinkedIn messages go unanswered"],
        ["Arjun, alumnus (2014)", "Product manager in Bengaluru, busy",
         "Stay in touch with batchmates; help juniors without being flooded",
         "Too many WhatsApp groups; afraid of spam"],
        ["Mr. Verma, senior alumnus (1992)", "Retired engineer, less comfortable with apps",
         "Find old friends; attend reunions; give back", "Apps feel complicated; small text"],
        ["Alumni cell / admin", "Faculty coordinator and committee members",
         "Verified alumni records; announcements; events", "Data is scattered in spreadsheets"],
    ], [0.2, 0.24, 0.29, 0.27], first_bold=True))
    st.append(Spacer(1, 6))
    st.append(callout("<b>Design for Mr. Verma and Riya at the same time.</b> Large tap targets, clear words, no "
                      "jargon, and a fast path for power users. If a 60-year-old can sign up in 3 minutes, everyone can.",
                      bg=CREAM, bar=MARIGOLD))

    # 04 Feature map
    st += section(4, "Feature map: 19 modules",
                  "Modules are grouped by what they do. \"Launch\" means it is in the first public release.")
    st.append(table([
        ["Code", "Module", "Group", "Release"],
        ["M1", "Sign-up and onboarding", "Identity", "Launch"],
        ["M2", "Verification (3 routes)", "Identity", "Launch"],
        ["M3", "Professional profile", "Identity", "Launch"],
        ["M4", "Alumni directory and search", "Connect", "Launch"],
        ["M5", "Home feed and public posts", "Community", "Launch"],
        ["M6", "Batch communities (auto-join)", "Community", "Launch"],
        ["M7", "Direct messages", "Connect", "Launch"],
        ["M8", "Connections and follows", "Connect", "Launch"],
        ["M9", "Notifications (in-app, push, email digest)", "Platform", "Launch"],
        ["M10", "Jobs and referrals", "Career", "V2"],
        ["M11", "Mentorship", "Career", "V2"],
        ["M12", "Events and reunions", "Career and events", "V2"],
        ["M13", "College news and \"Proud JECians\" wall", "College pride", "V2"],
        ["M14", "Admin and moderation console", "Admin", "Launch (basic)"],
        ["M15", "Privacy, safety and settings", "Admin", "Launch"],
        ["M16", "Analytics for the alumni cell", "Admin", "V2"],
        ["M17", "Interest circles and channels", "Community", "Launch (core)"],
        ["M18", "Invite and grow", "Growth", "Launch"],
        ["M19", "Engagement: birthdays, badges, spotlight, more", "Growth", "Launch (core)"],
    ], [0.1, 0.5, 0.22, 0.18]))

    # 05 UI/UX
    st += section(5, "UI/UX: the make-or-break section",
                  "If the app is confusing or ugly, people will try it once and leave. Design gets its own owner, "
                  "its own time in the schedule, and the power to block a release.")
    st.append(callout("<b>The target:</b> a new member finishes signing up in <b>under 3 minutes</b> and messages "
                      "a batchmate <b>within 5 minutes</b>. Every design decision is checked against this."))
    st += h2("Design principles")
    st.append(table([
        ["Principle", "In practice"],
        ["Familiar, not new", "Copy patterns people know: Instagram-style profile header, WhatsApp-style chat, "
                              "LinkedIn-style experience list. No custom gestures to learn."],
        ["One job per screen", "Each screen has one main action, shown as the single filled button."],
        ["Fast first", "Show content instantly (cached), load images later, skeletons instead of spinners. "
                       "Every screen usable on a ₹10,000 Android phone on 4G."],
        ["Progressive profile", "Ask only name, batch, branch and interests at sign-up. Ask the rest later with "
                                "a friendly \"profile 60% complete\" card."],
        ["Readable for all ages", "Minimum 16 px body text, 44 px tap targets, high contrast, works with the "
                                  "phone's large-text setting."],
        ["Calm by default", "Notifications are batched; nothing makes noise unless a person messaged you, "
                            "replied to you, or invited you."],
        ["Bilingual-ready", "English first; all text in one strings file so Hindi can be added in V2."],
    ], [0.25, 0.75], first_bold=True))
    st += h2("Navigation")
    st.append(P("Five bottom tabs, always visible: <b>Home</b> (feed), <b>Network</b> (directory and search), "
                "<b>Groups</b> (batch, circles, channels), <b>Chat</b> (messages) and <b>Me</b> (profile, invites, "
                "settings). A search bar sits at the top of Home and Network."))
    st += h2("Visual identity")
    st.append(swatches())
    st.append(P("<b>Fonts:</b> Inter for the app interface (free, very readable on small screens), with Noto Sans "
                "Devanagari added when Hindi arrives. Type scale: 28 / 22 / 18 / 16 / 14 / 12. "
                "<b>Corners:</b> 12 px cards, fully rounded buttons and chips. <b>Icons:</b> one free set "
                "(Lucide), outline style. <b>Dark mode</b> from launch, using the same tokens."))
    st += h2("Wireframes of key screens")
    st.append(P("Low-detail layouts to agree on structure. Final visuals come from the Figma prototype.", "small"))
    st.append(Spacer(1, 4))
    st.append(wireframe_row())
    st += h2("Design process (weeks 1 to 3, before any feature code)")
    st += bullets([
        "<b>Week 1:</b> interview 5 alumni and 5 students (15 minutes each) about how they stay in touch today. "
        "Map the sign-up, profile, message and invite flows.",
        "<b>Week 2:</b> design system in Figma (free education plan): colours, type, buttons, cards, chips, "
        "inputs, empty states. Clickable prototype of the 10 most important screens.",
        "<b>Week 3:</b> test the prototype with 5 alumni (including at least one aged 50+) and 5 students. "
        "Time them on sign-up and \"message a batchmate\". Fix every place where two or more people got stuck. "
        "Design lead signs off before coding starts.",
        "<b>After launch:</b> repeat a 5-person test every month; watch where people drop off in sign-up.",
    ])
    st += h2("Screen checklist: every screen must pass before release")
    st.append(table([
        ["Area", "Check"],
        ["Clarity", "One main action; a stranger can say what the screen is for in 5 seconds"],
        ["States", "Designed loading, empty, error and offline states (empty states tell you what to do next)"],
        ["Access", "Text contrast at least 4.5:1; tap targets at least 44 px; works with large text and a screen reader"],
        ["Speed", "Usable within 2 seconds on a mid-range Android phone on 4G"],
        ["Consistency", "Uses only design-system components and tokens; no one-off colours"],
        ["Words", "Plain English, no jargon, buttons say what they do (\"Send invite\", not \"Submit\")"],
        ["Devices", "Checked at 360 px phone width, a large phone, and desktop; light and dark mode"],
        ["Privacy", "Shows only what the viewer is allowed to see; private fields never leak into previews"],
    ], [0.18, 0.82], first_bold=True))
    st.append(Spacer(1, 6))
    st.append(callout("<b>Design lead:</b> one named person owns the design system and approves every UI change. "
                      "A pull request that changes a screen needs their approval, with a before/after screenshot.",
                      bg=CREAM, bar=MARIGOLD))

    # 06 Identity
    st += section(6, "Identity: sign-up, verification, profiles")
    st += module("M1", "Sign-up and onboarding", "Launch",
                 "Four short steps, with progress shown at the top. Everything else can be filled in later.", [
                     "<b>Step 1, sign in:</b> \"Continue with Google\" (one tap) or email with a 6-digit code. "
                     "No passwords and no paid SMS.",
                     "<b>Step 2, JEC details:</b> I am a student / alumnus / faculty; branch; year of joining and "
                     "graduation; roll or enrolment number (optional, speeds up verification).",
                     "<b>Step 3, interests:</b> pick at least 3 from chips (travel, trekking, yoga, photography, "
                     "cricket, startups, coding, music and more). This fills circle suggestions.",
                     "<b>Step 4, photo and headline:</b> optional, skippable. Then land on a welcome screen showing "
                     "your batch group and 3 batchmates to say hi to.",
                     "Members must be 18 or older at launch (avoids the extra parental-consent rules for minors).",
                 ])
    st += module("M2", "Verification (3 routes)", "Launch",
                 "Only verified members can message, post publicly or appear in search. Unverified users can "
                 "complete their profile and browse their own batch group in read-only mode.", [
                     "<b>Route A, college records (instant):</b> the name, branch, batch and roll number match the "
                     "batch lists the college provides. Students can also verify with a college email address, "
                     "if the college issues one.",
                     "<b>Route B, vouching (fast):</b> two verified members confirm \"I know this person from JEC\". "
                     "An invite from a verified member counts as one vouch.",
                     "<b>Route C, documents (fallback):</b> upload a degree, marksheet or college ID. A batch admin "
                     "checks it within 48 hours. The file is deleted after the decision.",
                     "A \"Verified\" badge shows on profiles. Faculty are verified by the alumni cell.",
                 ])
    st += module("M3", "Professional profile", "Launch",
                 "Like LinkedIn, but built around JEC. A strong profile is what makes people want to connect.", [
                     "<b>Header:</b> photo, cover, name, headline (\"SDE II at Flipkart\"), branch and batch, city, "
                     "verified badge, and buttons for Message and Connect.",
                     "<b>Sections:</b> About; Experience (company, role, years); Education (JEC plus others); "
                     "Skills; Achievements; links (LinkedIn, GitHub, website).",
                     "<b>\"I can help with\" tags:</b> referrals, mock interviews, higher studies, startups, "
                     "guidance for juniors. These power search and later mentorship.",
                     "Interests and circles, badges earned, and the member's recent posts.",
                     "Each field has a visibility setting: everyone at JEC, my batch, connections, or only me. "
                     "Phone and email are hidden by default.",
                     "Profile completeness meter with one suggestion at a time.",
                 ])

    # 07 Connect
    st += section(7, "Connect: directory, search, connections, messages")
    st += module("M4", "Alumni directory and search", "Launch",
                 "The core reason to open the app: \"find JECians who…\".", [
                     "Search by name, company, role, skill or city, tolerant of spelling mistakes.",
                     "Filters: branch, batch year (range), city, country, company, industry, \"can help with\", "
                     "student/alumni/faculty.",
                     "Smart lists on the Network tab: your batchmates, people in your city, people at your company, "
                     "people who share your interests, seniors who offer referrals.",
                     "Batch view: a grid of everyone in a batch, with a progress bar of how many have joined.",
                     "V2: map view of alumni by city.",
                 ])
    st += module("M7", "Direct messages", "Launch",
                 "Familiar WhatsApp-style chat, built so busy alumni are never flooded.", [
                     "1:1 text messages, photos and links; typing indicator; read receipts (can be turned off).",
                     "<b>Message requests:</b> a message from someone you are not connected to lands in Requests. "
                     "You can accept, ignore, or block and report.",
                     "Limits: a new member can start at most 10 new conversations a day; the limit rises with trust.",
                     "\"Who can message me\" setting: everyone at JEC, my batch and connections, or connections only.",
                     "V2: small group chats (up to 50) and message search.",
                 ])
    st += module("M8", "Connections and follows", "Launch",
                 "Two light ways to build a network.", [
                     "<b>Connect</b> (two-way, needs acceptance): you appear in each other's network and can always "
                     "message each other.",
                     "<b>Follow</b> (one-way): see someone's public posts without a request; useful for well-known "
                     "alumni.",
                     "Batchmates are suggested first; \"people you may know\" uses batch, branch, city and interests.",
                 ])
    st += module("M9", "Notifications", "Launch",
                 "Useful, never noisy.", [
                     "In-app inbox for everything; push notifications only for messages, replies, connection "
                     "requests, invites accepted and birthdays of connections.",
                     "Weekly email digest (opt-in): what happened in your batch and circles.",
                     "Per-type switches and a \"quiet hours\" setting.",
                 ])

    # 08 Community
    st += section(8, "Community: feed, batches, circles, channels")
    st.append(table([
        ["Space", "Who joins", "Who can post", "Example"],
        ["Public feed", "Everyone", "Any verified member", "\"Got into IIM Ahmedabad! Thanks to my seniors\""],
        ["Batch group", "Automatic, by branch and year (plus an all-branches year group)", "Members of that batch",
         "CSE 2016; JEC 2016 (all branches)"],
        ["Interest circle", "Anyone who chooses to", "Any member of the circle", "Trekking, Yoga Mornings, Startups"],
        ["Channel", "Anyone can follow", "Only channel admins (broadcast)", "JEC Official, Placement Updates"],
    ], [0.17, 0.3, 0.23, 0.3], first_bold=True))
    st += module("M5", "Home feed and public posts", "Launch",
                 "Where people see what JECians are doing.", [
                     "Post types: text, up to 4 photos, link preview, poll. Like, comment, share to chat, save.",
                     "Choose an audience for every post: all of JEC, my batch, or a circle.",
                     "Feed mixes posts from your batch, your circles, your connections and public posts, newest "
                     "first, with pinned announcements on top. Smarter ranking can come later.",
                     "Report any post; posts with several reports are hidden until a moderator reviews them.",
                 ])
    st += module("M6", "Batch communities", "Launch",
                 "Every member joins their batch automatically. This is the reason most alumni will first open the app.", [
                     "Two groups per member: branch batch (\"CSE 2016\") and whole-year batch (\"JEC 2016\").",
                     "Batch feed, member list with \"not yet joined\" count, and pinned posts by batch admins.",
                     "Two or three volunteer <b>batch admins</b> per batch: approve verifications, pin posts, moderate.",
                     "Reunion planning and photo albums arrive with Events in V2.",
                 ])
    st += module("M17", "Interest circles and channels", "Launch (core)",
                 "Connects JECians across batches through what they enjoy, not only when they graduated.", [
                     "<b>Circles</b> are groups where everyone can post: travel, trekking, yoga, photography, cricket, "
                     "running, startups, coding, music, books, higher studies abroad, UPSC/GATE and more.",
                     "The team creates 15 starter circles; members can propose new ones, which an admin approves.",
                     "Members can create city circles (\"JECians in Pune\").",
                     "<b>Channels</b> are broadcast-only, like WhatsApp channels: JEC Official, Placement Updates, "
                     "Alumni Cell, each with named admins. Followers can react but not post.",
                     "<b>V2, trip plans:</b> a circle member posts a trip (dates, place, cost share, seats); others "
                     "tap \"I'm in\"; a group chat is created for those going.",
                     "<b>V3, fitness challenges:</b> \"30 days of yoga\" or \"100 km in October\", with daily "
                     "check-ins, streaks and circle leaderboards.",
                 ])

    # 09 Grow
    st += section(9, "Grow and engage: invites, badges, birthdays",
                  "An alumni app is only as good as who is on it. Growth is a feature, not an afterthought.")
    st += module("M18", "Invite and grow", "Launch",
                 "Turn every member into a recruiter for their batch, without ever spamming anyone.", [
                     "Each member gets a personal invite link and QR code, with one-tap sharing to WhatsApp "
                     "and a ready-made message.",
                     "Invite anyone from any batch: a senior, a junior or a whole group of close friends at once "
                     "(share one link to a WhatsApp group).",
                     "An invite from a verified member counts as one vouch, so the friend gets verified faster.",
                     "<b>Batch progress:</b> \"CSE 2016: 38% on board\", shown in the batch group and on the "
                     "invite screen, with milestone celebrations at 25%, 50% and 75%.",
                     "<b>Badges:</b> Connector (5 friends joined), Batch Champion (25 joined), Founding Member "
                     "(joined in the first month). Leaderboards for top inviters per batch and branch vs branch.",
                     "<b>No-spam promise:</b> the app never messages invitees itself. Reminders such as "
                     "\"3 of your invites haven't joined yet\" go only to the person who invited them.",
                     "<i>Decision needed:</i> may verified members see the names of batchmates who haven't joined "
                     "(from college records), so they know whom to invite? See Section 23.",
                 ])
    st += module("M19", "Engagement features", "Launch (core)",
                 "Small reasons to come back every week.", [
                     "<b>At launch:</b> birthday reminders for your connections and batch, with one-tap wishes; "
                     "badges for profile complete, first post, helpful answers and invites; "
                     "<b>\"JECian of the Week\"</b> spotlight chosen by the alumni cell from nominations.",
                     "<b>V2:</b> \"Ask JEC\" Q&A forum (questions tagged by topic, answers upvoted, best answer marked); "
                     "city-wise blood donation and help network (members opt in with blood group and city; requests "
                     "go only to opted-in members nearby); directory of alumni-run businesses with JECian offers.",
                     "<b>V3:</b> 24-hour stories; quizzes about JEC; \"Throwback Thursday\" old-photo posts; "
                     "anniversary messages (\"10 years since you graduated!\").",
                 ])

    # 10 Career
    st += section(10, "Career, events and college pride")
    st += module("M10", "Jobs and referrals", "V2",
                 "Alumni post openings at their companies; students and alumni apply or ask for referrals.", [
                     "Job post: role, company, location, experience, link or \"ask me for a referral\".",
                     "Filters by role, location, experience, internship or full-time; save jobs; get alerts.",
                     "Referral requests go to the poster as a structured message with the applicant's profile.",
                     "Placement Updates channel for the college's training and placement cell.",
                 ])
    st += module("M11", "Mentorship", "V2",
                 "Structured help from seniors, without flooding them.", [
                     "Alumni set what they can help with and how many mentees they can take each month.",
                     "Students send a short request (goal, question); the mentor accepts or declines.",
                     "Office hours: mentors open slots; students book a 20-minute call (video link added by mentor).",
                     "Feedback after each session; \"Top Mentor\" badge.",
                 ])
    st += module("M12", "Events and reunions", "V2",
                 "From batch reunions to webinars and city meetups.", [
                     "Create an event (online or offline), RSVP, add to calendar, reminders, attendee list.",
                     "Reunion pages with photo albums and a planning chat.",
                     "Annual alumni meet and convocation pages managed by the alumni cell.",
                 ])
    st += module("M13", "College news and Proud JECians", "V2",
                 "Keep alumni connected to the college itself.", [
                     "College news, achievements and campus updates through the JEC Official channel.",
                     "\"Proud JECians\" wall: notable alumni stories, nominated by members and approved by the cell.",
                     "Later, with committee approval: give-back pages for scholarships or lab projects.",
                 ])

    # 11 Admin / privacy
    st += section(11, "Admin, privacy and safety")
    st += module("M14", "Admin and moderation console", "Launch (basic)",
                 "Web-only screens for the alumni cell, batch admins and moderators.", [
                     "Roles: super admin (alumni cell), moderator, batch admin, channel admin.",
                     "Verification queue (routes B and C), report queue, user search, suspend or ban.",
                     "Upload college batch lists (CSV) for route-A verification.",
                     "Create channels, pin announcements, approve new circles.",
                     "Every admin action is logged (who, what, when).",
                 ])
    st += module("M15", "Privacy, safety and settings", "Launch",
                 "Trust is the product. Designed for the Digital Personal Data Protection Act, 2023.", [
                     "Clear consent at sign-up, written in plain language; a privacy policy and terms page.",
                     "Per-field profile visibility; \"who can message me\"; hide from search.",
                     "Block and report on every profile, post, comment and message.",
                     "Download my data and delete my account (data removed within 30 days).",
                     "Spam limits: new conversations per day, posts per hour, links from new accounts held for review.",
                     "Security: row-level access rules in the database, so the app can never show data a user "
                     "should not see; all traffic over HTTPS; admin accounts use Google sign-in only.",
                     "A named grievance contact (required by the DPDP Act).",
                 ])
    st += module("M16", "Analytics for the alumni cell", "V2",
                 "Simple, privacy-friendly numbers.", [
                     "Members by batch, branch, city, country and industry; growth over time.",
                     "Engagement: active members, messages, posts, events, mentorship sessions.",
                     "Exports for the college (only totals; never personal data without consent).",
                 ])

    # 12 Journeys
    st += section(12, "Key user journeys")
    st += h2("A. New alumnus, invited by a friend (target: under 3 minutes)")
    st.append(table([
        ["Step", "What happens", "Time"],
        ["1", "Taps the invite link in WhatsApp; the app opens (or the web version, with an install prompt)", "10 s"],
        ["2", "\"Continue with Google\"", "15 s"],
        ["3", "Picks Alumnus, branch, batch; the inviter's vouch is applied automatically", "40 s"],
        ["4", "Picks 3+ interests", "30 s"],
        ["5", "Adds a photo and headline, or skips", "45 s"],
        ["6", "Welcome screen: \"You're in CSE 2016. 156 batchmates are here.\" Three suggested people to say hi to", "20 s"],
    ], [0.08, 0.77, 0.15]))
    st += h2("B. Student looking for a referral")
    st += bullets([
        "Network tab, search \"Google\", filter \"can help with: referrals\".",
        "Opens a senior's profile, sees shared branch and city, taps Message.",
        "The message goes to the senior's Requests with the student's profile card attached; the senior accepts "
        "and replies.",
    ])
    st += h2("C. Verification without college records")
    st += bullets([
        "Member signs up without an invite and their roll number isn't on any list yet.",
        "The app suggests: \"Ask 2 batchmates to vouch for you\" (share a link), or \"Upload a document\".",
        "Meanwhile they can finish their profile and read their batch group.",
        "Once verified, they get a notification and full access.",
    ])

    # 13 Budget
    st += section(13, "Budget: running at almost ₹0",
                  "Every service below has a free plan large enough for the first few thousand members. "
                  "Free limits change, so the team re-checks them before launch.")
    st.append(table([
        ["Need", "Service (free plan)", "Free allowance (approx.)", "Cost"],
        ["Database, login, file storage, realtime chat, server functions", "Supabase",
         "500 MB database, 1 GB files, 50,000 monthly users, 200 live connections", "₹0"],
        ["Sign-in", "Google sign-in + email one-time code via Supabase Auth", "Unlimited Google sign-ins", "₹0"],
        ["Sending emails (codes, digests)", "Brevo SMTP", "300 emails a day", "₹0"],
        ["Web hosting", "Cloudflare Pages", "Unlimited bandwidth, 500 builds a month", "₹0"],
        ["Push notifications", "Firebase Cloud Messaging", "Unlimited", "₹0"],
        ["Photo storage overflow (later)", "Cloudflare R2", "10 GB, no download fees (card needed on file)", "₹0"],
        ["Design", "Figma (education plan)", "Full features for students", "₹0"],
        ["Code, tasks, automated checks", "GitHub", "Free for public and private repos", "₹0"],
        ["Error tracking, analytics", "Sentry free plan; Cloudflare Web Analytics", "5,000 errors a month", "₹0"],
        ["Web address", "College subdomain (asked) or a free *.pages.dev address", "-", "₹0"],
        ["Android app", "Google Play developer account", "One-time fee", "<b>₹2,100</b>"],
        ["iPhone app", "Installable web app (PWA) in year one, instead of the App Store", "-", "₹0 (saves ₹8,300 a year)"],
    ], [0.27, 0.27, 0.32, 0.14]))
    st.append(Spacer(1, 6))
    st.append(callout("<b>Total: ₹0 a month, plus a one-time ₹2,100</b> for the Play Store, which we ask an alumnus to "
                      "sponsor. Until then, everyone (Android included) can use the installable web app.",
                      bg=CREAM, bar=MARIGOLD))
    st += h2("Rules that keep us inside the free limits")
    st += bullets([
        "Compress photos on the phone before upload: profile photos to 400 px (about 50 KB), post photos to "
        "1280 px (about 200 KB), WebP format.",
        "Load lists in pages of 20; never download a whole table.",
        "Use live connections only for open chats; everything else refreshes when you open the screen.",
        "Cache data on the phone so repeat visits don't hit the server.",
        "Delete verification documents after review; limit posts to 4 photos.",
        "Keep the project active (a weekly scheduled check), because free Supabase projects pause after a week "
        "of no activity.",
        "Watch usage in a simple dashboard and get an alert at 70% of any limit.",
    ])
    st += h2("When paying would make sense")
    st.append(P("Only when real usage demands it: roughly beyond 10,000 active members, more than 1 GB of photos, or "
                "a need for daily backups. Supabase Pro costs about US$25 a month (around ₹2,100). At that scale, "
                "alumni sponsorship of hosting is realistic. An Apple developer account (about ₹8,300 a year) is "
                "worth it only when many iPhone users ask for a native app."))

    # 14 Architecture
    st += section(14, "Technical architecture",
                  "One codebase for web, Android and admin. A managed backend so the team writes product, not servers.")
    st.append(architecture())
    st.append(Spacer(1, 8))
    st.append(table([
        ["Layer", "Choice", "Why"],
        ["Frontend", "React + Vite + TypeScript, Tailwind CSS, TanStack Query, React Router",
         "Widely known by students; fast; huge free ecosystem"],
        ["Installable app", "PWA with service worker (vite-plugin-pwa); offline cache",
         "Works on iPhone, Android and desktop without stores"],
        ["Android", "Trusted Web Activity built with Bubblewrap / PWABuilder",
         "Puts the same web app on the Play Store; no second codebase"],
        ["Backend", "Supabase: Postgres, Auth, Storage, Realtime, Edge Functions",
         "Free plan, no servers to run, row-level security"],
        ["Search", "Postgres full-text search + trigram matching for names",
         "Fast and typo-tolerant without a paid search service"],
        ["Push", "Firebase Cloud Messaging (web push, works on installed iPhone PWAs, iOS 16.4+)", "Free"],
        ["Quality", "ESLint, Prettier, Vitest, Playwright; GitHub Actions on every pull request",
         "Catches bugs before release"],
    ], [0.15, 0.47, 0.38], first_bold=True))
    st += h2("Engineering rules")
    st += bullets([
        "Every table has row-level security rules; the browser never has admin keys.",
        "Database changes only through versioned migration files in the repo.",
        "Separate development and production projects; test data never in production.",
        "Every pull request: automated checks pass, one code review, and design-lead approval if it changes a screen.",
        "Weekly database export to private storage (the free plan has no automatic backups).",
    ])

    # 15 Data model
    st += section(15, "Data model", "Main tables for the first launch. V2 adds jobs, mentorship and events.")
    st.append(table([
        ["Table", "What it stores"],
        ["profiles", "One row per member: name, photo, headline, role (student/alumnus/faculty), branch, batch, "
                     "city, about, visibility settings, verification status"],
        ["experiences, educations, skills", "Profile sections"],
        ["help_tags", "\"I can help with\" tags per member"],
        ["college_records", "Batch lists from the college (admin-only), used for verification"],
        ["verifications, vouches", "Verification requests, route, documents, decisions; who vouched for whom"],
        ["interests, profile_interests", "Interest list and each member's picks"],
        ["groups", "Batches, circles and channels (type, name, rules, visibility)"],
        ["group_members", "Membership and role (member, admin) in each group"],
        ["posts, post_media, comments, reactions", "Feed and group content"],
        ["connections, follows", "Two-way connections and one-way follows"],
        ["conversations, conversation_members, messages", "Direct messages and requests"],
        ["invites", "Invite codes, who invited whom, status"],
        ["badges, member_badges", "Badge definitions and awards"],
        ["notifications, push_tokens, notification_settings", "In-app inbox and push delivery"],
        ["reports, blocks, admin_actions", "Safety and audit trail"],
    ], [0.36, 0.64], first_bold=True))

    # 16 Screens
    st += section(16, "Screen list", "About 35 screens at launch. Each goes through the checklist in Section 05.")
    st.append(table([
        ["Area", "Screens"],
        ["Onboarding", "Welcome, sign in, email code, JEC details, interests, photo and headline, verification status, "
                       "welcome to your batch"],
        ["Home", "Feed, create post, post detail with comments, notifications"],
        ["Network", "Search and filters, smart lists, batch grid, connection requests, my connections"],
        ["Profile", "My profile, edit sections, other member's profile, profile completeness"],
        ["Groups", "My groups (batch, circles, channels), group feed, group members, discover circles, "
                   "propose a circle, channel view"],
        ["Chat", "Conversation list, requests, chat thread, media viewer"],
        ["Grow", "Invite (link, QR, share), my invites, batch progress, badges, leaderboard"],
        ["Settings", "Privacy, notifications, blocked users, download data, delete account, help and report"],
        ["Admin (web)", "Dashboard, verification queue, reports queue, users, college records upload, "
                        "channels and circles, spotlight"],
    ], [0.18, 0.82], first_bold=True))

    # 17 Scope
    st += section(17, "Release scope: Launch, V2, V3")
    st.append(table([
        ["Launch (week 14)", "V2 (about 3 months after)", "V3 (about 6 months after)"],
        ["<br/>".join(c) for c in [
            ["Sign-up and onboarding (M1)", "Verification, 3 routes (M2)", "Professional profile (M3)",
             "Directory and search (M4)", "Feed and public posts (M5)", "Batch groups (M6)", "Direct messages (M7)",
             "Connections and follows (M8)", "Notifications (M9)", "Admin console, basic (M14)",
             "Privacy and safety (M15)", "Circles and channels (M17)", "Invites, badges, leaderboards (M18)",
             "Birthdays, badges, JECian of the Week (M19)"],
            ["Jobs and referrals (M10)", "Mentorship (M11)", "Events and reunions (M12)",
             "College news, Proud JECians (M13)", "Analytics (M16)", "Ask JEC Q&amp;A", "Blood donation and help network",
             "Alumni business directory", "Trip plans", "Group chats, message search", "Hindi language", "Map view"],
            ["Stories", "Fitness challenges with streaks", "Quizzes and throwbacks", "Native iPhone app (if needed)",
             "Give-back and scholarship pages (if approved)", "Smarter feed ranking"],
        ]],
    ], [1 / 3] * 3, zebra=False))
    st.append(Spacer(1, 8))
    st.append(callout("<b>Rule:</b> nothing moves into the launch list unless something of similar size moves out. "
                      "A smaller app that feels great beats a big one that feels half-built."))

    # 18 Roadmap
    st += section(18, "Roadmap: 14 weeks to launch")
    st.append(table([
        ["Weeks", "Phase", "Deliverables"],
        ["1–3", "Design and setup", "Interviews, Figma design system and prototype, tested with 5 alumni + 5 students, "
                                    "design sign-off. In parallel: repo, automated checks, Supabase dev project, "
                                    "database schema, request batch lists from the college"],
        ["4–5", "Identity", "Sign-up and onboarding, verification (3 routes), profiles, privacy settings, "
                            "row-level security rules"],
        ["6–7", "Connect", "Directory and search, connections and follows, direct messages and requests"],
        ["8–9", "Community", "Feed and posts, batch groups, circles and channels, notifications and push"],
        ["10–11", "Grow", "Invites, QR, batch progress, badges, leaderboards, birthdays, JECian of the Week. "
                          "Start Play Store closed testing (12 testers for 14 days are required for new accounts)"],
        ["12", "Admin and hardening", "Admin console, reports and moderation, spam limits, accessibility and speed "
                                      "pass, privacy policy, security review"],
        ["13", "Closed beta", "One or two batches (about 200 people); fix the top issues; finish Play Store review"],
        ["14", "Public launch", "Launch batch by batch (Section 19)"],
    ], [0.1, 0.2, 0.7], first_bold=True))
    st.append(Spacer(1, 6))
    st.append(P("Every two weeks, the team demos working software to the alumni advisor. The roadmap assumes about "
                "15 hours a week per developer alongside classes; exam weeks are planned as lighter weeks."))

    # 19 Launch
    st += section(19, "Launch and growth plan",
                  "An empty app dies on day one. We launch batch by batch so every new member finds friends already there.")
    st.append(table([
        ["Stage", "Who", "How"],
        ["1. Seed", "Committee members, alumni cell, final-year students, 10 batch champions",
         "Personal invites; make sure each pilot batch has 20+ people and some posts before opening"],
        ["2. Pilot batches", "3 to 5 batches with active WhatsApp groups",
         "Batch champions share the invite in their groups; progress bar visible; fix issues fast"],
        ["3. Decade waves", "2015–2025, then 2005–2014, then earlier",
         "Each wave gets a launch post, a JECian of the Week from that decade, and a batch leaderboard"],
        ["4. Students", "All current students", "Introduced through the training and placement cell and "
                                                  "college clubs, once enough alumni are on board"],
        ["5. Ongoing", "Everyone", "Annual alumni meet, convocation, monthly spotlight, mentorship drives"],
    ], [0.17, 0.33, 0.5], first_bold=True))
    st += h2("Batch champions")
    st.append(P("One or two volunteers per batch who invite their batch, welcome newcomers, and act as batch admins. "
                "They get the Batch Champion badge and recognition at the annual meet."))

    # 20 Metrics
    st += section(20, "Success metrics")
    st.append(table([
        ["Metric", "How we measure it", "Target"],
        ["Sign-up time", "Median time from first screen to welcome screen", "Under 3 minutes"],
        ["Sign-up completion", "Share of people who start and finish sign-up", "Above 80%"],
        ["Time to first message", "From sign-up to first message sent", "Under 5 minutes for invited members"],
        ["Verification time", "From sign-up to verified", "Median under 24 hours"],
        ["Invite conversion", "Invites that turn into verified members", "Above 30%"],
        ["Batch coverage", "Share of each batch on the app", "30% in launched batches within 6 months"],
        ["Monthly active", "Members active in the last 30 days / all members", "Above 30%"],
        ["Week-4 retention", "New members still active 4 weeks later", "Above 40%"],
        ["Help given", "Student–alumni conversations with a reply", "500 in year one"],
        ["Running cost", "Monthly bills", "₹0"],
    ], [0.24, 0.48, 0.28], first_bold=True))

    # 21 Team
    st += section(21, "Team and roles")
    st.append(table([
        ["Role", "People", "Responsibilities"],
        ["Product lead", "1", "Owns this plan and scope, runs weekly planning, reports to the committee"],
        ["Design lead", "1", "Owns the design system and Figma, runs user tests, approves every UI change"],
        ["Frontend developers", "2–3", "Screens, PWA, Android packaging, accessibility and speed"],
        ["Backend developers", "1–2", "Database, security rules, functions, notifications, search"],
        ["QA and beta coordinator", "1", "Test plans, beta group, bug triage, Play Store testing"],
        ["Community and growth lead", "1", "Batch champions, launch waves, spotlight, social media"],
        ["Alumni advisor", "1 (alumnus)", "Guidance, reviews every two weeks, connects with the committee"],
        ["Faculty coordinator", "1", "College records, official channel, approvals from the college"],
    ], [0.27, 0.13, 0.6], first_bold=True))
    st += h2("Keeping the app alive after we graduate")
    st += bullets([
        "Code, designs and documentation live in an organisation account owned by the alumni cell, not by one student.",
        "Every year, juniors join the team in the second half and take over before the seniors graduate.",
        "A handover guide: how to deploy, rotate keys, add admins, and restore a backup.",
    ])

    # 22 Risks
    st += section(22, "Risks and how we handle them")
    st.append(table([
        ["Risk", "Impact", "What we do"],
        ["App feels empty at launch", "High", "Batch-by-batch launch, seeding, batch champions, invite rewards"],
        ["Confusing or ugly UI", "High", "Design-first process, user testing, design lead, screen checklist"],
        ["Spam or misuse of messages", "High", "Verification, message requests, daily limits, block and report, moderation"],
        ["Privacy breach", "High", "Row-level security, privacy-by-default, security review, minimal data, DPDP compliance"],
        ["Free limits exceeded", "Medium", "Photo compression, pagination, usage alerts at 70%, sponsor plan ready"],
        ["Team members graduate or get busy", "Medium", "Documentation, junior pipeline, organisation-owned accounts"],
        ["College records unavailable", "Medium", "Vouching and document routes still work"],
        ["Low alumni activity after sign-up", "Medium", "Birthdays, spotlight, weekly digest, events, circles"],
        ["Play Store review delays", "Low", "Start closed testing in week 10; the web app works meanwhile"],
    ], [0.3, 0.12, 0.58], first_bold=True))

    # 23 Decisions
    st += section(23, "Decisions for the alumni committee",
                  "We need these answers to stay on schedule. The week shows when each answer is needed.")
    st.append(table([
        ["#", "Decision", "Why it matters", "Needed by"],
        ["1", "Official endorsement: may we use the JEC name and logo, and announce through college channels?",
         "Trust and reach", "Week 2"],
        ["2", "Will the college share batch lists (name, branch, year, roll number) for verification?",
         "Instant verification (route A)", "Week 4"],
        ["3", "Will the college give a free web address (for example alumni.<college domain>)?",
         "Credibility, easy to remember", "Week 10"],
        ["4", "Will an alumnus sponsor the ₹2,100 Play Store fee?", "Android app listing", "Week 9"],
        ["5", "Can verified members see the names of batchmates who haven't joined yet (from college records)?",
         "Big boost to invites, but a privacy decision", "Week 9"],
        ["6", "Who are the super admins and moderators? Can we appoint batch admins?", "Moderation and verification",
         "Week 11"],
        ["7", "Approve the community guidelines and privacy policy", "Legal and safety", "Week 12"],
        ["8", "Which 3 to 5 batches pilot first?", "Launch plan", "Week 12"],
    ], [0.05, 0.5, 0.3, 0.15]))
    st.append(Spacer(1, 6))
    st.append(callout("<b>Later, not urgent:</b> should the alumni association register as a society or trust? "
                      "This only matters if we later accept donations or run scholarships through the app.",
                      bg=CREAM, bar=MARIGOLD))

    # 24 Next steps
    st += section(24, "Next steps")
    st.append(table([
        ["When", "Action", "Owner"],
        ["This week", "Share this plan with the team and alumni committee; collect feedback", "Product lead"],
        ["This week", "Confirm roles (Section 21), especially the design lead", "Team"],
        ["Week 1", "Committee meeting on decisions 1, 2 and 4", "Product lead + alumni advisor"],
        ["Week 1", "Start interviews with 5 alumni and 5 students", "Design lead"],
        ["Week 1", "Create GitHub organisation, Supabase dev project, Figma team", "Backend lead"],
        ["Week 3", "Prototype test and design sign-off", "Design lead"],
        ["Week 4", "Start building (Identity phase)", "Developers"],
    ], [0.15, 0.6, 0.25], first_bold=True))
    st.append(Spacer(1, 16))
    st.append(callout("<b>The one-line summary:</b> a beautiful, trusted, free app where every JECian can build a "
                      "profile, find and message anyone from JEC, join their batch and interest groups, and bring "
                      "their friends along."))
    return st


def main():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                          topMargin=MARGIN, bottomMargin=20 * mm,
                          title="JEC Alumni Connect: Plan v2.0", author="JEC Alumni Connect team",
                          subject="Product, design and implementation plan")
    frame = Frame(MARGIN, 20 * mm, CONTENT_W, PAGE_H - MARGIN - 20 * mm, id="f")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[frame], onPage=on_cover),
        PageTemplate(id="main", frames=[frame], onPage=on_page),
    ])
    story = [Spacer(1, 1)] + build()
    doc.build(story)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
