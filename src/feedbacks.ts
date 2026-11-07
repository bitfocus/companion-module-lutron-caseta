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
	if (choices.length === 0) {
		self.setFeedbackDefinitions({})
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

	const feedbacks: CompanionFeedbackDefinitions = {
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
	self.setFeedbackDefinitions(feedbacks)
}
