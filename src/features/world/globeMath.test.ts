import { describe, expect, it } from 'vitest'
import { cobeVector, globeFocus, globeMarkerSize, nearestMarker, projectGlobe, shortestTurn, wrapAngle } from './globeMath'

describe('globe maths', () => {
  it('puts the focused city in the middle, facing the viewer', () => {
    for (const [lat, lng] of [[23.18, 79.95], [51.5, -0.12], [-33.9, 151.2], [37.77, -122.42], [0, 0]] as const) {
      const f = globeFocus(lat, lng, 1)
      const p = projectGlobe(lat, lng, f.phi, f.theta)
      expect(p.visible).toBe(true)
      expect(p.x).toBeCloseTo(0.5, 6)
      expect(p.y).toBeCloseTo(0.5, 6)
    }
  })

  it('hides the far side of the globe', () => {
    const f = globeFocus(23.18, 79.95, 1)
    expect(projectGlobe(37.77, -122.42, f.phi, f.theta).visible).toBe(false) // San Francisco behind Jabalpur
    expect(projectGlobe(28.6, 77.2, f.phi, f.theta).visible).toBe(true) // Delhi next door
  })

  it('north is up', () => {
    const f = globeFocus(23, 80, 1)
    expect(projectGlobe(28.6, 77.2, f.phi, f.theta).y).toBeLessThan(0.5)
    expect(projectGlobe(13, 77.6, f.phi, f.theta).y).toBeGreaterThan(0.5)
  })

  it('east is right', () => {
    const f = globeFocus(23, 80, 1)
    expect(projectGlobe(22.5, 88.4, f.phi, f.theta).x).toBeGreaterThan(0.5) // Kolkata
    expect(projectGlobe(19, 72.8, f.phi, f.theta).x).toBeLessThan(0.5) // Mumbai
  })

  it('unit vectors', () => {
    const [x, y, z] = cobeVector(45, 30)
    expect(x * x + y * y + z * z).toBeCloseTo(1, 9)
    expect(cobeVector(90, 0)[1]).toBeCloseTo(1, 9)
  })

  it('softens the tilt and clamps polar latitudes', () => {
    expect(globeFocus(80, 0).theta).toBeCloseTo(((60 * Math.PI) / 180) * 0.75, 9)
  })

  it('angles', () => {
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 9)
    expect(wrapAngle(5 * Math.PI)).toBeCloseTo(Math.PI, 9)
    expect(shortestTurn(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2, 9)
    expect(shortestTurn(2 * Math.PI - 0.1, 0.1)).toBeCloseTo(0.2, 9)
    expect(shortestTurn(1, 2)).toBeCloseTo(1, 9)
  })

  it('marker sizes grow by area and stay in range', () => {
    expect(globeMarkerSize(0, 10)).toBe(0.02)
    expect(globeMarkerSize(10, 10)).toBeCloseTo(0.09, 9)
    expect(globeMarkerSize(1000, 10)).toBeCloseTo(0.09, 9)
    expect(globeMarkerSize(25, 100)).toBeCloseTo(0.055, 9)
  })

  it('finds the nearest visible marker to a tap', () => {
    const pts = [
      { x: 0.5, y: 0.5, visible: true },
      { x: 0.52, y: 0.5, visible: false },
      { x: 0.9, y: 0.9, visible: true },
    ]
    expect(nearestMarker(pts, { x: 0.515, y: 0.5 })).toBe(0)
    expect(nearestMarker(pts, { x: 0.2, y: 0.2 })).toBe(-1)
    expect(nearestMarker(pts, { x: 0.88, y: 0.9 })).toBe(2)
  })
})
