import { Briefcase, FileText, FolderArchive, GraduationCap, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Card, Notice, SectionTitle } from '../../components/ui/Display'
import { Checkbox } from '../../components/ui/Form'
import { LinkedInIcon } from '../../components/ui/Icons'
import { friendlyError } from '../../lib/errors'
import { useMyProfile } from '../auth/AuthProvider'
import { useSaveImport, type ImportedProfile } from './queries'

type Source = 'pdf' | 'zip'

async function parse(file: File, source: Source): Promise<ImportedProfile> {
  if (source === 'zip') {
    const { readLinkedInZip } = await import('../../lib/linkedin/exportZip')
    return readLinkedInZip(file)
  }
  const { readLinkedInPdf } = await import('../../lib/linkedin/profilePdf')
  return readLinkedInPdf(file)
}

function Picker({ source, onPicked, busy }: { source: Source; onPicked: (f: File) => void; busy: boolean }) {
  const pdf = source === 'pdf'
  return (
    <label className="flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-6 font-semibold text-on-primary hover:bg-primary-hover">
      {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : pdf ? <FileText className="size-5" aria-hidden /> : <FolderArchive className="size-5" aria-hidden />}
      {busy ? 'Reading your file…' : pdf ? 'Choose LinkedIn PDF' : 'Choose LinkedIn .zip file'}
      <input
        type="file"
        accept={pdf ? 'application/pdf,.pdf' : 'application/zip,.zip'}
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onPicked(f)
        }}
      />
    </label>
  )
}

export function LinkedInImportPage() {
  const { data: profile } = useMyProfile()
  const save = useSaveImport()
  const navigate = useNavigate()
  const [source, setSource] = useState<Source>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ImportedProfile | null>(null)
  const [keepEx, setKeepEx] = useState<boolean[]>([])
  const [keepEd, setKeepEd] = useState<boolean[]>([])
  const [overwrite, setOverwrite] = useState(false)

  async function onPicked(file: File) {
    setError(null)
    if (file.size > 20 * 1024 * 1024) return setError('That file is too large (max 20 MB).')
    setBusy(true)
    try {
      const result = await parse(file, source)
      if (!result.experiences.length && !result.educations.length && !result.headline && !result.skills?.length) {
        throw new Error('We couldn’t find profile details in this file. Please check it’s the right file, or add details manually.')
      }
      setData(result)
      setKeepEx(result.experiences.map(() => true))
      setKeepEd(result.educations.map(() => true))
    } catch (e) {
      setError(e instanceof Error ? e.message : friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function onSave() {
    if (!data) return
    try {
      await save.mutateAsync({
        ...data,
        experiences: data.experiences.filter((_, i) => keepEx[i]),
        educations: data.educations.filter((_, i) => keepEd[i]),
        overwriteBasics: overwrite,
        current: profile,
      })
      toast.success('Profile updated from LinkedIn')
      navigate('/me')
    } catch {
      /* shown below */
    }
  }

  if (data) {
    return (
      <div>
        <PageHeader title="Review before saving" back="/me/import" action={<Button variant="ghost" size="sm" onClick={() => setData(null)}>Start over</Button>} />
        <Page className="space-y-6">
          <Notice tone="info" title="Check everything looks right">
            Untick anything you don’t want on your profile. You can edit it all later.
          </Notice>

          {(data.headline || data.city || data.about) && (
            <section>
              <SectionTitle>Basics</SectionTitle>
              <Card className="space-y-2 p-4 text-[15px]">
                {data.headline && <p><span className="text-muted">Headline: </span>{data.headline}</p>}
                {data.city && <p><span className="text-muted">City: </span>{data.city}</p>}
                {data.about && <p className="line-clamp-4 whitespace-pre-line"><span className="text-muted">About: </span>{data.about}</p>}
              </Card>
            </section>
          )}

          {data.experiences.length > 0 && (
            <section>
              <SectionTitle>Experience ({keepEx.filter(Boolean).length} of {data.experiences.length})</SectionTitle>
              <Card className="divide-y divide-border">
                {data.experiences.map((e, i) => (
                  <div key={i} className="flex items-start gap-3 p-3">
                    <Checkbox checked={!!keepEx[i]} onChange={(v) => setKeepEx((k) => k.map((x, j) => (j === i ? v : x)))}>
                      <span className="flex gap-3">
                        <Briefcase className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                        <span>
                          <span className="block font-semibold">{e.title}</span>
                          <span className="block text-sm text-muted">
                            {e.company}
                            {e.start_date && ` · ${e.start_date.slice(0, 4)}–${e.is_current ? 'Present' : (e.end_date?.slice(0, 4) ?? '')}`}
                          </span>
                        </span>
                      </span>
                    </Checkbox>
                  </div>
                ))}
              </Card>
            </section>
          )}

          {data.educations.length > 0 && (
            <section>
              <SectionTitle>Education</SectionTitle>
              <Card className="divide-y divide-border">
                {data.educations.map((e, i) => (
                  <div key={i} className="p-3">
                    <Checkbox checked={!!keepEd[i]} onChange={(v) => setKeepEd((k) => k.map((x, j) => (j === i ? v : x)))}>
                      <span className="flex gap-3">
                        <GraduationCap className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                        <span>
                          <span className="block font-semibold">{e.school}</span>
                          <span className="block text-sm text-muted">
                            {[e.degree, e.field].filter(Boolean).join(', ')}
                            {(e.start_year || e.end_year) && ` · ${[e.start_year, e.end_year].filter(Boolean).join('–')}`}
                          </span>
                        </span>
                      </span>
                    </Checkbox>
                  </div>
                ))}
              </Card>
            </section>
          )}

          {!!data.skills?.length && (
            <section>
              <SectionTitle>Skills</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {data.skills.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
                    {s}
                    <button
                      type="button"
                      className="grid size-7 place-items-center rounded-full hover:bg-border"
                      aria-label={`Remove ${s}`}
                      onClick={() => setData({ ...data, skills: data.skills!.filter((x) => x !== s) })}
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}

          <Checkbox checked={overwrite} onChange={setOverwrite}>
            Replace my existing headline, city, about, current role, skills and LinkedIn link (otherwise only empty fields are filled)
          </Checkbox>

          {save.error && <Notice tone="danger" title={friendlyError(save.error)} />}
          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:bottom-0">
            <Button size="lg" block loading={save.isPending} onClick={onSave}>
              Save to my profile
            </Button>
          </div>
        </Page>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Import from LinkedIn" back="/me" />
      <Page className="space-y-6">
        <div className="flex items-center gap-3">
          <LinkedInIcon className="size-10" />
          <p className="text-[15px] text-muted">Bring your experience, education and skills over in about 30 seconds. Your file is read on your device; you review everything before it’s saved.</p>
        </div>

        <div role="tablist" aria-label="Import method" className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
          {(['pdf', 'zip'] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={source === s}
              className={`min-h-10 rounded-full text-sm font-semibold ${source === s ? 'bg-surface text-primary shadow-sm' : 'text-muted'}`}
              onClick={() => {
                setSource(s)
                setError(null)
              }}
            >
              {s === 'pdf' ? 'Profile PDF (fastest)' : 'Data export (most complete)'}
            </button>
          ))}
        </div>

        {source === 'pdf' ? (
          <Card className="space-y-4 p-4">
            <ol className="list-decimal space-y-2 pl-5 text-[15px]">
              <li>
                On a computer, open <a className="font-semibold text-primary underline" href="https://www.linkedin.com/in/me/" target="_blank" rel="noreferrer">your LinkedIn profile</a>.
              </li>
              <li>Click <strong>More</strong> (or <strong>Resources</strong>) below your name, then <strong>Save to PDF</strong>.</li>
              <li>Upload that PDF here. On a phone, you can upload it from Downloads, Drive or email.</li>
            </ol>
            <Picker source="pdf" onPicked={onPicked} busy={busy} />
          </Card>
        ) : (
          <Card className="space-y-4 p-4">
            <ol className="list-decimal space-y-2 pl-5 text-[15px]">
              <li>
                Open <a className="font-semibold text-primary underline" href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noreferrer">LinkedIn: Get a copy of your data</a>.
              </li>
              <li>Choose <strong>“Want something in particular?”</strong> and tick <strong>Profile</strong>, <strong>Positions</strong>, <strong>Education</strong> and <strong>Skills</strong>. Request the archive.</li>
              <li>LinkedIn emails you a link, usually within 10 minutes. Download the .zip and upload it here.</li>
            </ol>
            <Picker source="zip" onPicked={onPicked} busy={busy} />
          </Card>
        )}

        {error && <Notice tone="danger" title={error} />}
        <p className="text-sm text-muted">
          Why not connect automatically? LinkedIn only shares full profiles with its paid partners, and copying LinkedIn pages automatically breaks
          their rules, so we use your own file instead.
        </p>
      </Page>
    </div>
  )
}
