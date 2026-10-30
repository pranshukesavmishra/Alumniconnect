// Reads pasted profile text: on the device, or with the site's free AI when it is switched on.
import type { AiProfile } from './mapping'
import { parsePastedProfile } from './pasteParser'
import { aiFill } from './queries'

/** On-device reading, or the AI's when it is on; any AI problem falls back to the on-device reading without a word. */
export async function readPasted(text: string, aiOn: boolean, ai: (t: string) => Promise<AiProfile> = aiFill): Promise<{ profile: AiProfile; by: 'ai' | 'device' }> {
  const device = parsePastedProfile(text)
  if (aiOn) {
    try {
      const got = await ai(text)
      // keep the device reading when it clearly found more jobs than the AI did
      if (got.experiences.length + 1 >= device.experiences.length) return { profile: { ...got, linkedin_url: got.linkedin_url ?? device.linkedin_url }, by: 'ai' }
    } catch {
      /* fall back */
    }
  }
  return { profile: device, by: 'device' }
}
