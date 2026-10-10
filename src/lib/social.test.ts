import { describe, expect, it } from 'vitest'
import { isCanonicalSocialUrl, normalizeFacebookUrl as fb, normalizeInstagramUrl as ig, socialHandle, socialInputValue } from './social'

describe('normalizeInstagramUrl', () => {
  it.each([
    ['anil.k', 'https://www.instagram.com/anil.k/'],
    ['@anil_k', 'https://www.instagram.com/anil_k/'],
    ['  @Anil.K  ', 'https://www.instagram.com/Anil.K/'],
    ['instagram.com/anil.k', 'https://www.instagram.com/anil.k/'],
    ['www.instagram.com/anil.k/', 'https://www.instagram.com/anil.k/'],
    ['http://instagram.com/anil.k', 'https://www.instagram.com/anil.k/'],
    ['https://m.instagram.com/anil.k/?igsh=abc123&utm_source=qr#x', 'https://www.instagram.com/anil.k/'],
    ['https://www.instagram.com/anil.k/?hl=en', 'https://www.instagram.com/anil.k/'],
    ['https://INSTAGRAM.com/anil.k/', 'https://www.instagram.com/anil.k/'],
    ['https://instagr.am/anil.k', 'https://www.instagram.com/anil.k/'],
    ['https://www.instagram.com/_u/anil.k/', 'https://www.instagram.com/anil.k/'],
    ['https://www.instagram.com/anil.k/reels/', 'https://www.instagram.com/anil.k/'],
    ['a', 'https://www.instagram.com/a/'],
    ['a'.repeat(30), `https://www.instagram.com/${'a'.repeat(30)}/`],
  ])('accepts %s', (input, out) => expect(ig(input)).toBe(out))

  it.each([
    '', '   ', '@', 'a'.repeat(31), 'anil k', 'anil-k', 'anil!', 'ani/l', 'ünil',
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'ftp://instagram.com/x',
    'https://instagram.com.evil.com/anil', 'https://www.instagram.com.evil.com/anil', 'instagram.com.evil.com', 'instagram.com.evil.com/anil',
    'https://evil.com/instagram.com/anil', 'https://evil.com?u=instagram.com/anil', 'https://notinstagram.com/anil', 'https://fakeinstagram.com/anil',
    'https://instagram.com@evil.com/anil', 'https://instagram.com:pw@evil.com/anil', 'https://user@instagram.com/anil',
    'https://instagram.com\\@evil.com', 'https://instagram.com:8080/anil', 'https://xn--nstagram-0ya.com/anil', 'https://іnstagram.com/anil',
    'https://www.instagram.com/', 'https://www.instagram.com', 'https://www.instagram.com/p/ABC123/', 'https://www.instagram.com/explore/',
    'https://www.instagram.com/accounts/login/', 'https://www.instagram.com/<script>/', 'https://www.instagram.com/an il/',
    'https://www.facebook.com/anil', 'https://l.instagram.com/?u=https://evil.com', 'https://www.instagram.com/a"onmouseover=1',
    'https://www.instagram.com/anil\n.evil', 'https://www.instagram.com/an\til', '//evil.com/anil', 'x'.repeat(600),
  ])('rejects %j', (input) => expect(ig(input)).toBeNull())

  it('does not throw on garbage', () => {
    for (const s of ['http://', 'https://[', '%%%', '\u0000', 'https://@@@', ':::', 'http:///x']) expect(() => ig(s)).not.toThrow()
  })
})

describe('normalizeFacebookUrl', () => {
  it.each([
    ['facebook.com/anil.k', 'https://www.facebook.com/anil.k'],
    ['https://www.facebook.com/anil.k/', 'https://www.facebook.com/anil.k'],
    ['http://facebook.com/anil.k', 'https://www.facebook.com/anil.k'],
    ['https://m.facebook.com/anil.k?ref=bookmarks&fbclid=xyz', 'https://www.facebook.com/anil.k'],
    ['https://web.facebook.com/anil.k', 'https://www.facebook.com/anil.k'],
    ['https://mbasic.facebook.com/anil.k', 'https://www.facebook.com/anil.k'],
    ['fb.com/anil.k', 'https://www.facebook.com/anil.k'],
    ['https://www.fb.com/anil.k', 'https://www.facebook.com/anil.k'],
    ['https://fb.me/anil.k', 'https://www.facebook.com/anil.k'],
    ['https://www.facebook.com/profile.php?id=100012345678901', 'https://www.facebook.com/profile.php?id=100012345678901'],
    ['https://m.facebook.com/profile.php?id=100012345678901&ref=x&sk=photos', 'https://www.facebook.com/profile.php?id=100012345678901'],
    ['facebook.com/profile.php?id=12345', 'https://www.facebook.com/profile.php?id=12345'],
    ['https://www.facebook.com/people/Anil-Kumar/100012345678901/', 'https://www.facebook.com/people/Anil-Kumar/100012345678901'],
    ['https://www.facebook.com/pages/Some-Page/12345?ref=x', 'https://www.facebook.com/pages/Some-Page/12345'],
    ['https://www.facebook.com/p/Some-Page-61555555555555/', 'https://www.facebook.com/p/Some-Page-61555555555555'],
    ['https://www.facebook.com/anil.k/photos', 'https://www.facebook.com/anil.k'],
    ['anil.kumar', 'https://www.facebook.com/anil.kumar'],
    ['@anil.kumar', 'https://www.facebook.com/anil.kumar'],
    ['https://www.facebook.com/100012345678', 'https://www.facebook.com/100012345678'],
  ])('accepts %s', (input, out) => expect(fb(input)).toBe(out))

  it.each([
    '', '  ', 'abc', 'an il kumar', 'anil!kumar', 'a'.repeat(51),
    'javascript:alert(1)', 'data:text/html,x', 'ftp://facebook.com/anil', 'file:///etc/passwd',
    'https://facebook.com.evil.com/anil', 'https://www.facebook.com.evil.com/anil', 'facebook.com.evil.com', 'facebook.com.evil.com/anil',
    'https://evil.com/facebook.com/anil', 'https://evil.com/?u=https://www.facebook.com/anil', 'https://notfacebook.com/anil', 'https://fb.me.evil.com/anil',
    'https://facebook.com@evil.com/anil', 'https://user:pw@facebook.com/anil', 'https://facebook.com:8443/anil',
    'https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.com', 'https://www.facebook.com/l.php?u=https://evil.com', 'https://www.facebook.com/sharer.php?u=x',
    'https://www.facebook.com/sharer/sharer.php', 'https://www.facebook.com/dialog/share', 'https://www.facebook.com/login', 'https://www.facebook.com/share/p/abc',
    'https://www.facebook.com/profile.php?id=abc', 'https://www.facebook.com/profile.php', 'https://www.facebook.com/profile.php?id=12',
    'https://www.facebook.com/photo.php?fbid=1', 'https://www.facebook.com/', 'https://www.facebook.com', 'https://www.facebook.com/<script>',
    'https://www.facebook.com/an il', 'https://www.facebook.com/pages/', 'https://www.facebook.com/people/x/y.php', 'https://www.instagram.com/anil',
    'https://evil.com', '//evil.com/anil', 'https://xn--facebook-9ya.com/anil', 'y'.repeat(600),
  ])('rejects %j', (input) => expect(fb(input)).toBeNull())
})

describe('helpers', () => {
  it('only canonical urls count', () => {
    expect(isCanonicalSocialUrl('instagram', 'https://www.instagram.com/anil.k/')).toBe(true)
    expect(isCanonicalSocialUrl('instagram', 'https://instagram.com/anil.k')).toBe(false)
    expect(isCanonicalSocialUrl('instagram', 'javascript:alert(1)')).toBe(false)
    expect(isCanonicalSocialUrl('facebook', 'https://www.facebook.com/anil.k')).toBe(true)
    expect(isCanonicalSocialUrl('facebook', 'https://www.facebook.com/anil.k/')).toBe(false)
    expect(isCanonicalSocialUrl('facebook', null)).toBe(false)
  })
  it('is idempotent', () => {
    for (const s of ['@anil.k', 'instagram.com/anil.k?x=1']) expect(ig(ig(s)!)).toBe(ig(s))
    for (const s of ['fb.me/anil.k', 'facebook.com/profile.php?id=12345&x=1', 'facebook.com/people/A-B/123456']) expect(fb(fb(s)!)).toBe(fb(s))
  })
  it('makes readable labels', () => {
    expect(socialHandle('instagram', 'https://www.instagram.com/anil.k/')).toBe('@anil.k')
    expect(socialHandle('facebook', 'https://www.facebook.com/anil.k')).toBe('anil.k')
    expect(socialHandle('facebook', 'https://www.facebook.com/people/Anil-Kumar/100012345678901')).toBe('Anil Kumar')
    expect(socialHandle('facebook', 'https://www.facebook.com/profile.php?id=12345')).toBe('Facebook')
    expect(socialInputValue('instagram', 'https://www.instagram.com/anil.k/')).toBe('@anil.k')
    expect(socialInputValue('facebook', 'https://www.facebook.com/anil.k')).toBe('facebook.com/anil.k')
    expect(socialInputValue('facebook', null)).toBe('')
  })
})
