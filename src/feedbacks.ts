import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
import type { ModuleInstance } from './main.js'

const COMPARISONS = [
	{ id: 'gt', label: 'is above' },
	{ id: 'gte', label: 'is at or above' },
	{ id: 'lt', label: 'is below' },
	{ id: 'lte', label: 'is at or below' },
	{ id: 'eq', label: 'is exactly' },
]

export function UpdateFeedbacks(self: ModuleInstance): void {
	const choices = self.lightDevices().map((device) => ({ id: device.SerialNumber, label: self.deviceLabel(device) }))
	const feedbacks: CompanionFeedbackDefinitions = {}

	if (self.config.includePicos && self.picoButtons.length > 0) {
		const picoChoices = self.picoButtons.map((button) => ({ id: button.id, label: button.label }))
		feedbacks.pico_pressed = {
			name: 'Pico button is pressed',
			description: 'True from the moment the Pico button is pressed until it is released',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(230, 126, 34), color: combineRgb(255, 255, 255) },
			options: [
				{ id: 'button', type: 'dropdown', label: 'Pico button', choices: picoChoices, default: picoChoices[0].id },
			],
			callback: (feedback) => self.picoPressed.get(feedback.options.button as string) === true,
		}
	}

	if (choices.length === 0) {
		self.setFeedbackDefinitions(feedbacks)
		return
	}

	const deviceOption = {
		id: 'device',
		type: 'dropdown' as const,
		label: 'Light',
		choices,
		default: choices[0].id,
	}
	const onStyle = { bgcolor: combineRgb(0, 153, 0), color: combineRgb(255, 255, 255) }

	const lightFeedbacks: CompanionFeedbackDefinitions = {
		dimmer_on: {
			name: 'Light is on',
			description: 'True when the light is on (level above 0)',
			type: 'boolean',
			defaultStyle: onStyle,
			options: [deviceOption],
			callback: (feedback) => {
				const level = self.levelFor(feedback.options.device as string)
				return level !== undefined && level > 0
			},
		},
		dimmer_level: {
			name: 'Light level compared to value',
			description: 'True when the light level (0-100) meets the comparison',
			type: 'boolean',
			defaultStyle: onStyle,
			options: [
				deviceOption,
				{ id: 'comparison', type: 'dropdown', label: 'Level', choices: COMPARISONS, default: 'gt' },
				{ id: 'value', type: 'number', label: 'Value', min: 0, max: 100, default: 50 },
			],
			callback: (feedback) => {
				const level = self.levelFor(feedback.options.device as string)
				if (level === undefined) return false
				const value = feedback.options.value as number
				switch (feedback.options.comparison) {
					case 'gt':
						return level > value
					case 'gte':
						return level >= value
					case 'lt':
						return level < value
					case 'lte':
						return level <= value
					default:
						return level === value
				}
			},
		},
	}
	self.setFeedbackDefinitions({ ...feedbacks, ...lightFeedbacks })
}
