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
				'To pair with a Lutron Smart Bridge, press the pair button on the bridge and then press save within 30 seconds or refresh the page if the connection shows an error',
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
