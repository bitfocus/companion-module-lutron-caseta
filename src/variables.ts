import type { CompanionVariableDefinition } from '@companion-module/base'
import type { ModuleInstance } from './main.js'

// One level variable (0-100) per light, such as $(lutron-caseta:12345678_level)
export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinition[] = self.lightDevices().map((device) => ({
		variableId: `${device.SerialNumber}_level`,
		name: `${self.deviceLabel(device)} level`,
	}))

	if (self.config.includePicos) {
		definitions.push(
			{ variableId: 'last_pico_device', name: 'Last Pico button pressed: remote name' },
			{ variableId: 'last_pico_button', name: 'Last Pico button pressed: button name' },
			{ variableId: 'last_pico_event', name: 'Last Pico button event (Press or Release)' },
		)
	}

	self.setVariableDefinitions(definitions)
}
