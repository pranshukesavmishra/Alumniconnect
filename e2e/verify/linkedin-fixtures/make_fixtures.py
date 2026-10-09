"""Builds SYNTHETIC LinkedIn "Save to PDF" look-alikes (fake people) for e2e/verify/linkedin-import.spec.ts.

They copy the measured layout of real exports (Apache FOP, see docs/LINKEDIN_PDF.md): same font sizes, columns,
line gaps and metadata (Author=LinkedIn). Real samples of real people are never committed.

  python3 -I e2e/verify/linkedin-fixtures/make_fixtures.py   (needs reportlab + Pillow; FreeSans for Devanagari)
"""
import io
import os
import sys

from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = os.path.dirname(os.path.abspath(__file__))
pdfmetrics.registerFont(TTFont('FreeSans', '/usr/share/fonts/truetype/freefont/FreeSans.ttf'))
F = 'FreeSans'
MAIN_X, SIDE_X = 223.6, 21.6


class Doc:
    def __init__(self, name, author='LinkedIn'):
        self.c = canvas.Canvas(os.path.join(OUT, name), pagesize=(612, 792))
        self.c.setAuthor(author)
        self.c.setTitle('Resume')
        self.c.setSubject('Resume generated from profile')
        self.page = 1

    def t(self, x, y, size, text):
        self.c.setFont(F, size)
        self.c.drawString(x, y, text)

    def m(self, y, size, text):
        self.t(MAIN_X, y, size, text)

    def s(self, y, size, text):
        self.t(SIDE_X, y, size, text)

    def new_page(self, total):
        self.t(270, 20, 9, f'Page {self.page} of {total}')
        self.c.showPage()
        self.page += 1

    def save(self, total):
        self.t(270, 20, 9, f'Page {self.page} of {total}')
        self.c.save()


def jec_profile(fname, variant):
    """variant 'v1' = first import, 'v2' = the member changed jobs on LinkedIn (re-import must replace, not duplicate)."""
    d = Doc(fname)
    # sidebar
    d.s(737.6, 13, 'Contact')
    d.s(718.2, 10.5, 'rahul.sharma@example.com')
    d.s(693.8, 11, 'www.linkedin.com/in/rahul-')
    d.s(679.4, 11, 'sharma-jec (LinkedIn)')
    d.s(644.6, 13, 'Top Skills')
    d.s(625.1, 10.5, 'Automotive Engineering')
    d.s(607.5, 10.5, 'Python (Programming Language)')
    d.s(589.9, 10.5, 'CATIA' if variant == 'v1' else 'Electric Vehicles')
    d.s(555.2, 13, 'Languages')
    d.s(535.7, 10.5, 'हिन्दी (Native or Bilingual)')
    d.s(518.1, 10.5, 'English (Professional Working)')
    # main header
    d.m(726.5, 26, 'राहुल शर्मा (Rahul Sharma)')
    d.m(705.3, 12, 'Senior Engineer at Tata Motors | JEC CSE 2012' if variant == 'v1' else 'Lead Engineer at Ola Electric | JEC CSE 2012')
    d.m(689.9, 12, 'Jabalpur, Madhya Pradesh, India' if variant == 'v1' else 'Bengaluru, Karnataka, India')
    d.m(652.3, 15.75, 'Summary')
    d.m(626.8, 12, 'Automotive engineer from Jabalpur Engineering College. I build')
    d.m(608.8, 12, 'vehicle software and mentor juniors.')
    d.m(572.8, 12, 'Happy to help JECians with referrals.')
    d.m(519.0, 15.75, 'Experience')
    y = 488.5
    if variant == 'v2':
        d.m(y, 12, 'Ola Electric'); d.m(y - 16.1, 11.5, 'Lead Engineer')
        d.m(y - 30.6, 10.5, 'January 2025 - Present (1 year 10 months)'); d.m(y - 45.3, 10.5, 'Bengaluru, Karnataka, India')
        y -= 84
    # multi-role company: company, total duration, then roles
    d.m(y, 12, 'Tata Motors')
    d.m(y - 16.1, 10.5, '6 years 2 months')
    d.m(y - 37.4, 11.5, 'Senior Engineer')
    d.m(y - 51.9, 10.5, 'March 2022 - Present (2 years 8 months)' if variant == 'v1' else 'March 2022 - December 2024 (2 years 10 months)')
    d.m(y - 66.6, 10.5, 'Pune, Maharashtra, India')
    d.m(y - 88.0, 10.5, 'Leading the powertrain software team.')
    d.m(y - 106.0, 10.5, '- Shipped 3 vehicle programmes')
    d.m(y - 139.6, 11.5, 'Engineer')
    d.m(y - 154.1, 10.5, 'September 2018 - February 2022 (3 years 6 months)')
    d.m(y - 175.5, 10.5, 'Worked on body control modules.')
    y -= 214
    d.m(y, 12, 'भारतीय रेल (Indian Railways)')
    d.m(y - 16.1, 11.5, 'Summer Intern')
    d.m(y - 30.6, 10.5, 'May 2011 - July 2011 (3 months)')
    d.m(y - 45.3, 10.5, 'Jabalpur')
    y -= 90
    d.m(y, 15.75, 'Education')
    d.m(y - 25.5, 12, 'Jabalpur Engineering College')
    d.m(y - 43.1, 10.5, 'Bachelor of Engineering - BE, Computer Science · (2008 - 2012)')
    d.m(y - 76.5, 12, 'Kendriya Vidyalaya No. 1, Jabalpur')  # no degree, no dates
    d.save(1)


def not_linkedin(fname):
    d = Doc(fname, author='Someone')
    d.t(72, 720, 18, 'Quarterly report')
    d.t(72, 690, 11, 'Revenue grew 12% - 2023 - 2024. This is not a LinkedIn profile.')
    d.save(1)


def scanned(fname):
    from PIL import Image, ImageDraw
    img = Image.new('RGB', (1224, 1584), 'white')
    dr = ImageDraw.Draw(img)
    for i in range(30):
        dr.text((100, 80 + i * 45), 'Scanned resume line %d - Experience 2019 - Present' % i, fill='black')
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    buf.seek(0)
    d = Doc(fname, author='Scanner')
    d.c.drawImage(ImageReader(buf), 0, 0, 612, 792)
    d.c.save()


def long_profile(fname, pages=30):
    """A very long but valid LinkedIn-style PDF (more pages than the reader's 20-page cap)."""
    d = Doc(fname)
    d.s(737.6, 13, 'Contact')
    d.s(681.2, 11, 'www.linkedin.com/in/long-profile-test (LinkedIn)')
    d.m(726.5, 26, 'Long Profile')
    d.m(705.3, 12, 'Consultant')
    d.m(689.9, 12, 'Indore, Madhya Pradesh, India')
    d.m(652.3, 15.75, 'Experience')
    n = 0
    for p in range(pages):
        y = 620 if p == 0 else 737
        while y > 120:
            d.m(y, 12, f'Company {n}')
            d.m(y - 16.1, 11.5, f'Role {n}')
            d.m(y - 30.6, 10.5, 'January 2010 - December 2010 (1 year)')
            y -= 70
            n += 1
        if p < pages - 1:
            d.new_page(pages)
    d.save(pages)


if __name__ == '__main__':
    jec_profile('linkedin-jec-v1.pdf', 'v1')
    jec_profile('linkedin-jec-v2.pdf', 'v2')
    not_linkedin('linkedin-not-a-profile.pdf')
    scanned('linkedin-scanned.pdf')
    long_profile('linkedin-long.pdf')
    print('fixtures written to', OUT, file=sys.stderr)
