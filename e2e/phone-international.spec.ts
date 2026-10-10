import { expect, test, type Page } from '@playwright/test'
import { signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const email = `phone.${run}@example.com`
const phoneInDb = () => sql(`select coalesce(phone, 'NULL') from profile_private where id = (select id from auth.users where email = '${email}')`)

async function pickCountry(page: Page, search: string, optionName: RegExp) {
  await page.getByTestId('phone-country').click()
  const dialog = page.getByRole('dialog', { name: 'Choose country' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill(search)
  await dialog.getByRole('option', { name: optionName }).click()
  await expect(dialog).toBeHidden()
}

test('mobile numbers: India by default, pick another country, invalid numbers are blocked, saved as E.164 and shown again after reload', async ({ page }) => {
  await page.goto('/signin')
  await signInWithEmail(page, email)

  // onboarding: India is preselected
  await expect(page.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeVisible()
  await expect(page.getByTestId('phone-country')).toContainText('+91')
  await expect(page.getByTestId('phone-country')).toHaveAccessibleName(/India/)
  await page.getByLabel('Full name').fill(`Phone ${run}`)
  await page.getByText('Alumnus / Alumna').click()
  await page.getByLabel('Branch').selectOption('B.E. in Computer Science & Engineering')
  await page.getByLabel('Passing-out year', { exact: true }).selectOption('2008')
  await page.getByLabel('City you live in').fill('London')

  // an Indian number must start with 6-9 and have 10 digits
  await page.getByLabel('Mobile number').fill('1234567890')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('An Indian mobile number has 10 digits and starts with 6, 7, 8 or 9.')).toBeVisible()
  await page.getByLabel('Mobile number').fill('98765')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Numbers in India have 10 digits after +91. Please check yours.')).toBeVisible()

  // choose the UK from the searchable list (type part of the name), then a number
  await pickCountry(page, 'united king', /United Kingdom/)
  await expect(page.getByTestId('phone-country')).toContainText('+44')
  await page.getByLabel('Mobile number').fill('7700900123')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome to JEC Alumni Connect' })).toBeHidden()
  await expect.poll(phoneInDb).toBe('+447700900123')

  // edit profile: it opens as UK + the number, and survives a reload
  await page.goto('/me/edit')
  await expect(page.getByTestId('phone-country')).toContainText('+44')
  await expect(page.getByLabel('Mobile number')).toHaveValue('7700900123')
  await page.reload()
  await expect(page.getByTestId('phone-country')).toContainText('+44')
  await expect(page.getByLabel('Mobile number')).toHaveValue('7700900123')

  // a UK number with a digit missing is refused in words and nothing is saved
  await page.getByLabel('Mobile number').fill('770090012')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Numbers in United Kingdom have 10 digits after +44. Please check yours.')).toBeVisible()
  expect(phoneInDb()).toBe('+447700900123')

  // search by dial code and by keyboard only: +65 Singapore, Down/Enter
  await page.getByTestId('phone-country').click()
  const dialog = page.getByRole('dialog', { name: 'Choose country' })
  await dialog.getByRole('combobox').fill('+65')
  await expect(dialog.getByRole('option').first()).toContainText('Singapore')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('phone-country')).toContainText('+65')
  await page.getByLabel('Mobile number').fill('91234567')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect.poll(phoneInDb).toBe('+6591234567')

  // an old stored number ("+91 98765 43210") opens as India + the digits, and saving tidies it to E.164
  sql(`update profile_private set phone = '+91 98765 43210' where id = (select id from auth.users where email = '${email}')`)
  await page.goto('/me/edit')
  await expect(page.getByTestId('phone-country')).toContainText('+91')
  await expect(page.getByLabel('Mobile number')).toHaveValue('9876543210')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect.poll(phoneInDb).toBe('+919876543210')
  sql(`update profile_private set phone = '9123456789' where id = (select id from auth.users where email = '${email}')`)
  await page.goto('/me/edit')
  await expect(page.getByTestId('phone-country')).toContainText('+91')
  await expect(page.getByLabel('Mobile number')).toHaveValue('9123456789')

  // the last country chosen is remembered for the next empty box
  sql(`update profile_private set phone = null where id = (select id from auth.users where email = '${email}')`)
  await pickCountry(page, 'germany', /Germany/)
  await page.goto('/me/edit')
  await expect(page.getByTestId('phone-country')).toContainText('+49')

  // pasting a whole international number sets the country as well
  await page.getByLabel('Mobile number').fill('+971 50 123 4567')
  await expect(page.getByTestId('phone-country')).toContainText('+971')
  await expect(page.getByLabel('Mobile number')).toHaveValue('501234567')
})
