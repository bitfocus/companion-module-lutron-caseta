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

export function isPicoDevice(device: DeviceDefinition): boolean {
	return device.DeviceType.startsWith('Pico') && (device.ButtonGroups?.length ?? 0) > 0
}

// One physical Pico button. `id` is stable across renames (device serial plus bridge button number).
export interface PicoButton {
	id: string
	href: string
	deviceName: string
	buttonName: string
	label: string
}

// Returns 'Press' or 'Release' (the only types seen from Picos), or undefined if the body is not a button event
export function parseButtonEvent(body: unknown): string | undefined {
	const b = body as { ButtonStatus?: { ButtonEvent?: { EventType?: string } } } | undefined
	return b?.ButtonStatus?.ButtonEvent?.EventType
}

// Printed legends on the Pico3ButtonRaiseLower (PJ2-3BRL) remote, by bridge ButtonNumber (named "Button 1" to "Button 5")
const PICO_3BRL_FUNCTIONS: Record<number, string> = {
	0: 'On',
	1: 'Favorite',
	2: 'Off',
	3: 'Raise',
	4: 'Lower',
}

// "BlueTag: Button 1 (On)" for 5-button remotes. Scene Picos keep the bridge's name alone because
// what their buttons do depends on how they are programmed.
export function picoButtonLabel(device: DeviceDefinition, buttonName: string, buttonNumber: number): string {
	const legend = device.DeviceType === 'Pico3ButtonRaiseLower' ? PICO_3BRL_FUNCTIONS[buttonNumber] : undefined
	return `${device.Name}: ${buttonName}${legend ? ` (${legend})` : ''}`
}
