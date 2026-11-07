import type { DeviceDefinition } from 'lutron-leap'

// Device types that this module treats as lights (switches and dimmers with a level)
const LIGHT_DEVICE_TYPES = ['WallSwitch', 'WallDimmer', 'DivaSmartDimmer', 'PlugInDimmer', 'PlugInSwitch']

export function isLightDevice(device: DeviceDefinition): boolean {
	return LIGHT_DEVICE_TYPES.includes(device.DeviceType)
}

export function zoneHrefOf(device: DeviceDefinition): string | undefined {
	return device.LocalZones?.[0]?.href
}

export interface ZoneLevel {
	zoneHref: string
	level: number // 0 (off) to 100 (full)
}

interface RawZoneStatus {
	Level?: number
	SwitchedLevel?: string
	Zone?: { href?: string }
}

// A /zone/status body is either one status (event) or a list of them (read or subscribe response).
// Switches report SwitchedLevel (On/Off) and may omit Level, so fall back to 100 or 0.
export function parseZoneStatuses(body: unknown): ZoneLevel[] {
	if (!body || typeof body !== 'object') return []
	const b = body as { ZoneStatus?: RawZoneStatus; ZoneStatuses?: RawZoneStatus[] }
	const statuses = b.ZoneStatuses ?? (b.ZoneStatus ? [b.ZoneStatus] : [])

	const result: ZoneLevel[] = []
	for (const status of statuses) {
		const zoneHref = status.Zone?.href
		if (!zoneHref) continue
		let level: number | undefined
		if (typeof status.Level === 'number') {
			level = status.Level
		} else if (status.SwitchedLevel === 'On') {
			level = 100
		} else if (status.SwitchedLevel === 'Off') {
			level = 0
		}
		if (level !== undefined) result.push({ zoneHref, level })
	}
	return result
}
