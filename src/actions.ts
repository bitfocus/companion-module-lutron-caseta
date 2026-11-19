import { CompanionActionDefinition } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { DeviceDefinition } from 'lutron-leap'
import { DEFAULT_FADE_TIME } from './config.js'

export async function UpdateActions(self: ModuleInstance): Promise<void> {
	const deviceActions: Record<string, CompanionActionDefinition> = {}

	for (const device of self.devicesOnBridge) {
		const areaName = self.areaNames.get(device.SerialNumber)
		if (!areaName) {
			self.log('warn', `No area name for device ${device.Name}, skipping its actions`)
			continue
		}
		self.log('debug', `creating actions for ${areaName} ${device.Name}`)
		const deviceKeyName = device.SerialNumber
		if (
			device.DeviceType === 'WallSwitch' ||
			device.DeviceType === 'WallDimmer' ||
			device.DeviceType === 'DivaSmartDimmer' ||
			device.DeviceType === 'PlugInDimmer' ||
			device.DeviceType === 'PlugInSwitch'
		) {
			deviceActions[`${deviceKeyName}_turn_on`] = createDimmerAction(self, areaName, device, 'on')
			deviceActions[`${deviceKeyName}_turn_off`] = createDimmerAction(self, areaName, device, 'off')
		}
		if (
			device.DeviceType === 'WallDimmer' ||
			device.DeviceType === 'DivaSmartDimmer' ||
			device.DeviceType === 'PlugInDimmer'
		) {
			deviceActions[`${deviceKeyName}_set_brightness`] = createDimmerAction(self, areaName, device, 'brightness')
		}
	}

	self.setActionDefinitions({
		...deviceActions,
		...createSceneAction(self),
	})
}

// fade time input is in seconds but needs to be formatted for the API. So 1.75 seconds becomes "00:00:01.7500"
function formatFadeTime(seconds: number): string {
	const totalMs = Math.round(Math.max(0, seconds) * 1000)
	const whole = Math.floor(totalMs / 1000)
	const frac = (totalMs % 1000) * 10 // milliseconds to ten-thousandths
	return `00:00:${whole.toString().padStart(2, '0')}.${frac.toString().padStart(4, '0')}`
}

function createSceneAction(self: ModuleInstance): Record<string, CompanionActionDefinition> {
	if (self.sceneButtons.length === 0) return {}
	const choices = self.sceneButtons.map((scene) => ({ id: scene.href, label: scene.name }))
	return {
		activate_scene: {
			name: 'Activate Scene',
			options: [{ id: 'scene', type: 'dropdown', label: 'Scene', choices, default: choices[0].id }],
			callback: async (event) => {
				const href = event.options.scene as string
				try {
					self.log('debug', `Activating scene ${href}`)
					const response = await self.bridge?.client.request('CreateRequest', `${href}/commandprocessor`, {
						Command: { CommandType: 'PressAndRelease' },
					})
					if (!response?.Header.StatusCode?.code || response.Header.StatusCode.code > 299) {
						self.log('error', `Error activating scene ${href}: ${JSON.stringify(response?.Header.StatusCode)}`)
					}
				} catch (err) {
					self.log('error', `Error activating scene ${href}: ${(err as Error).message}`)
				}
			},
		},
	}
}

function createDimmerAction(
	self: ModuleInstance,
	areaName: string,
	device: DeviceDefinition,
	actionType: 'on' | 'off' | 'brightness',
): CompanionActionDefinition {
	const isOnOff = actionType === 'on' || actionType === 'off'
	const fixedLevel = actionType === 'on' ? 100 : actionType === 'off' ? 0 : undefined

	const options: CompanionActionDefinition['options'] = []

	if (!isOnOff) {
		options.push({
			id: 'brightness_value',
			type: 'number',
			label: 'Brightness Value',
			range: true,
			default: 50,
			min: 0,
			max: 100,
		})
	}

	options.push({
		id: 'use_default_fade',
		type: 'checkbox',
		label: 'Use module default fade time',
		default: true,
	})
	options.push({
		id: 'fade_time',
		type: 'number',
		label: 'Fade Time (seconds)',
		default: DEFAULT_FADE_TIME,
		min: 0,
		max: 10,
		step: 0.25,
		range: true,
		isVisible: (options) => !options.use_default_fade,
	})

	return {
		name: `${areaName} ${device.Name}: ${actionType === 'on' ? 'Turn On' : actionType === 'off' ? 'Turn Off' : 'Set Brightness'}`,
		options,
		callback: async (event) => {
			const level = isOnOff ? fixedLevel : (event.options.brightness_value as number)

			const fadeTimeValue = event.options.use_default_fade
				? (self.config.defaultFadeTime ?? DEFAULT_FADE_TIME)
				: (event.options.fade_time as number) || 0
			const fadeTimeFormatted = formatFadeTime(fadeTimeValue)

			try {
				self.log('debug', `Setting ${device.Name} to ${level}% with fade time ${fadeTimeFormatted}`)
				const response = await self.bridge?.client.request(
					'CreateRequest',
					`${device.LocalZones[0].href}/commandprocessor`,
					{
						Command: {
							CommandType: 'GoToDimmedLevel',
							DimmedLevelParameters: { Level: level, FadeTime: fadeTimeFormatted },
						},
					},
				)
				if (!response?.Header.StatusCode?.code || response.Header.StatusCode.code > 299) {
					const errorMessage = response?.Body && 'Message' in response.Body ? response.Body.Message : 'Unknown error'
					self.log(
						'error',
						`Error setting ${device.Name}: ${response?.Header.StatusCode?.code} ${response?.Header.StatusCode?.message} - ${errorMessage}`,
					)
				}
			} catch (err) {
				self.log('error', `Error setting ${device.Name} ${actionType || 'brightness'}: ${(err as Error).message}`)
			}
		},
	}
}
