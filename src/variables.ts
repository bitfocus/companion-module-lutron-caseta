import type { ModuleInstance } from './main.js'

// One level variable (0-100) per light, such as $(lutron-caseta:12345678_level)
export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions(
		self.lightDevices().map((device) => ({
			variableId: `${device.SerialNumber}_level`,
			name: `${self.deviceLabel(device)} level`,
		})),
	)
}
