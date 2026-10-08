# LinkedIn "Save to PDF": layout reference

Measured with pdfjs-dist 6.4 from 27 real exports (Apache FOP 2.2 and 2.3, Nov 2022 to Sep 2026). The parser is `src/lib/linkedin/profilePdf.ts`.

- Page 612×792. Sidebar lines start at x≈21.6, main column at x≈223.6 (split at x=200). The footer "Page N of M" is size 9.
- One font for everything, with no bold. Roles are told apart by size, column and order:
  - **Main column:** name 26; headline, location, summary, company and school 12; section headers 15.75; job title 11.5; dates, location, description, degree and the multi-role total duration 10.5.
  - **Sidebar:** headers 13; skills and contact details 10.5; URLs 11.
- Section titles follow the member's UI language ("Experiencia", "Опыт работы"), so the parser works from structure, not titles.
- **Multi-role company:** company (12), then a duration line like "9 years 7 months" (10.5), then title, date and optional location blocks.
- **Date line:** "August 2022 - Present (2 years 1 month)". Year-only and localised months also occur; "Present" stays in English.
- **Degree line:** "Degree, Field · (2001 - 2005)". The date part is optional and may wrap.
- **Optional job location:** sits ~14.7pt below the date line; a description starts ~20pt below.
- **Wrapping across lines or pages:** sections continue over page breaks. URLs and emails wrap mid-word, so wrapped parts are joined without a space.

To re-run the parser over real samples locally (they are not committed, because they are real people's profiles):

```
LINKEDIN_SAMPLES=/path/to/pdfs npx vitest run src/lib/linkedin/profilePdf.samples.test.ts
```
