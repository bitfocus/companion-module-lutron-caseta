import type {
	CompanionStaticUpgradeScript,
	CompanionUpgradeContext,
	CompanionStaticUpgradeProps,
	CompanionStaticUpgradeResult,
} from '@companion-module/base'
import type { ModuleConfig, ModuleSecrets } from './config.js'

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>[] = [
	/*
	 * Place your upgrade scripts here
	 * Remember that once it has been added it cannot be removed!
	 */
	// Actions saved before the module default fade time existed keep their explicit fade time
	function (
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, ModuleSecrets>,
	): CompanionStaticUpgradeResult<ModuleConfig, ModuleSecrets> {
		const updatedActions = props.actions.filter((action) => {
			if (action.options.use_default_fade !== undefined) return false
			if (!('fade_time' in action.options)) return false
			action.options.use_default_fade = false
			return true
		})
		return { updatedConfig: null, updatedActions, updatedFeedbacks: [] }
	},
]
