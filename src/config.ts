import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig {
	host: string
	port: number
	ca?: string
	certificate?: string
	privateKey?: string
	bridgeID?: string
}

export function GetConfigFields(discoveredBridges: Record<string, string>): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info1',
			width: 8,
			label: 'Pairing Instructions',
			value:
				'Select your Lutron Bridge from the dropdown below, or enter in the IP address manually. Then after you hit Save, press the black pairing button on your Lutron Bridge. If it does not pair, turn the connection off and back on to re-initiate pairing, and press the button again.',
		},
		{
			type: 'dropdown',
			id: 'host',
			label: 'Host',
			description: 'Enter the IP address of the bridge or select one from the dropdown.',
			width: 8,
			choices: Object.entries(discoveredBridges).map(([ipAddr, bridgeID]) => {
				return { id: ipAddr, label: `${ipAddr} (${bridgeID})` }
			}),
			default: '',
			regex: Regex.IP,
			allowCustom: true,
		} as SomeCompanionConfigField, // type assertion because description isn't in the base type definition
	]
}
