import {
	InstanceBase,
	runEntrypoint,
	InstanceStatus,
	SomeCompanionConfigField,
	CompanionVariableValues,
} from '@companion-module/base'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import {
	PairingClient,
	BridgeFinder,
	BridgeNetInfo,
	LeapClient,
	SmartBridge,
	DeviceDefinition,
	OneAreaDefinition,
} from 'lutron-leap'
import forge from 'node-forge'
import { readFileSync } from 'node:fs'
import {
	isLightDevice,
	isPicoDevice,
	zoneHrefOf,
	parseZoneStatuses,
	parseButtonEvent,
	picoButtonLabel,
	type PicoButton,
} from './devices.js'

const PAIRING_PORT = 8083
const LEAP_PORT = 8081
const UNKNOWN_BRIDGE_ID = 'unknown-bridge-id'
const RECONNECT_INITIAL_MS = 2000
const RECONNECT_MAX_MS = 30000
const CONNECT_TIMEOUT_MS = 10000
const HEALTH_CHECK_INTERVAL_MS = 30000
const HEALTH_CHECK_TIMEOUT_MS = 8000
const HEALTH_CHECK_MAX_FAILURES = 2

// lutron-leap has no connect timeout, so an unreachable bridge can hang for over a minute
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(message)), ms)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}

// Read the version from the manifest shipped with the module (dist/ sits next to companion/)
function moduleVersion(): string {
	try {
		const manifest = JSON.parse(readFileSync(new URL('../companion/manifest.json', import.meta.url), 'utf8')) as {
			version?: string
		}
		return manifest.version ?? 'unknown'
	} catch {
		return 'unknown'
	}
}

export class ModuleInstance extends InstanceBase<ModuleConfig, ModuleSecrets> {
	config!: ModuleConfig // Setup in init()
	secrets!: ModuleSecrets
	discoveredBridges: Record<string, string>
	bridge?: SmartBridge
	devicesOnBridge: DeviceDefinition[]
	sceneButtons: { href: string; name: string }[]
	areaNames: Map<string, string> // device serial number -> area name
	zoneLevels: Map<string, number> // zone href -> level (0-100)
	picoDevices: DeviceDefinition[] // includes Picos not assigned to a room
	picoButtons: PicoButton[]
	picoPressed: Map<string, boolean> // PicoButton id -> currently held
	lastPico = { device: '', button: '', event: '' }
	private reconnectTimer?: NodeJS.Timeout
	private reconnectDelay = RECONNECT_INITIAL_MS
	private healthTimer?: NodeJS.Timeout
	private healthFailures = 0
	private connecting = false
	private lostWhileConnecting = false
	private shuttingDown = false
	constructor(internal: unknown) {
		super(internal)
		this.discoveredBridges = {}
		this.devicesOnBridge = []
		this.sceneButtons = []
		this.areaNames = new Map()
		this.zoneLevels = new Map()
		this.picoDevices = []
		this.picoButtons = []
		this.picoPressed = new Map()
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets

		this.log('info', `Lutron Caseta module version ${moduleVersion()} starting`)

		// discover bridges (used for dropdown in config)
		this.log('debug', 'Starting bridge discovery')
		this.updateStatus(InstanceStatus.Connecting, 'Initializing')
		await this.startDiscovery()

		// if we have certs, connect to bridge
		if (this.secrets.bridgeCerts) {
			await this.connectToBridge()
		}

		await this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
	}

	async startDiscovery(): Promise<void> {
		const bridgeFinder = new BridgeFinder()
		bridgeFinder.on('discovered', (bridgeInfo: BridgeNetInfo) => {
			this.discoveredBridges[bridgeInfo.ipAddr] = bridgeInfo.bridgeid
			this.log('info', `Discovered Bridge ${bridgeInfo.bridgeid} at ${bridgeInfo.ipAddr}: ${bridgeInfo.systype}`)
		})
		bridgeFinder.beginSearching()
	}

	async pairWithBridge(): Promise<void> {
		const client = new PairingClient(this.config.host, PAIRING_PORT)
		try {
			this.log('debug', 'Pairing client connecting')
			await client.connect()
		} catch (e: any) {
			this.updateStatus(InstanceStatus.ConnectionFailure, `Failed to initialize pairing: ${e.message}`)
			this.log('error', `Failed to initialize pairing: ${e.message}`)
			return
		}

		// wait for pairing button to be pressed on bridge
		this.log('info', 'Waiting for button press on bridge...')
		try {
			await new Promise<void>((resolve, reject) => {
				const t = setTimeout(() => reject(new Error('timed out')), 30000) // Pairing window is 30 seconds, but companion has a 5s timeout
				client.once('message', (response) => {
					this.log('debug', `got message ${JSON.stringify(response)}`)
					const res = response as { Body: { Status: { Permissions: string[] } } }
					if (res.Body.Status.Permissions.includes('PhysicalAccess')) {
						this.log('debug', 'Physical access confirmed')
						clearTimeout(t)
						resolve()
					} else {
						this.log('debug', `unexpected pairing result ${JSON.stringify(response)}`)
					}
				})
			})
		} catch (e: any) {
			this.log('error', `waiting for button push failed. ${e}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, `Pairing timed out: ${e.message}`)
			return
		}

		// generate  keys
		this.log('debug', 'Generating keys for CSR')
		const keys = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
			forge.pki.rsa.generateKeyPair({ bits: 2048 }, (err, keyPair) => {
				if (err !== null) {
					this.log('error', `key generation error: ${err.message}`)
					reject(err)
				} else {
					resolve(keyPair)
				}
			})
		})

		// generate csr and sign with private key
		const csr = forge.pki.createCertificationRequest()
		csr.publicKey = keys.publicKey
		csr.setSubject([
			{
				name: 'commonName',
				value: 'companion-module-lutron-caseta',
			},
		])
		csr.sign(keys.privateKey)
		const csrText = forge.pki.certificationRequestToPem(csr)

		// pair with bridge using csr
		this.log('debug', 'Sending CSR to bridge for signing')
		let certResult
		try {
			certResult = await new Promise<any>((resolve, reject) => {
				const t = setTimeout(() => reject(new Error('CSR response timed out')), 5000)
				client.once('message', (response) => {
					clearTimeout(t)
					resolve(response)
				})

				void client.requestPair(csrText)
			})

			if (certResult.Header.StatusCode !== '200 OK') {
				throw new Error(`bad CSR response: ${JSON.stringify(certResult)}`)
			}
		} catch (e: any) {
			this.log('error', `CSR failed: ${e.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, `CSR failed: ${e.message}`)
			return
		}

		// store cert/keys
		if (this.config.host in this.discoveredBridges) {
			this.config.bridgeID = this.discoveredBridges[this.config.host]
		} else {
			this.config.bridgeID = UNKNOWN_BRIDGE_ID // id needs to be resolved later
		}

		this.log('debug', `using bridge id: ${this.config.bridgeID}`)

		this.log('debug', 'Storing bridge certificates')
		this.secrets.bridgeCerts = {
			ca: certResult.Body.SigningResult.RootCertificate,
			certificate: certResult.Body.SigningResult.Certificate,
			privateKey: forge.pki.privateKeyToPem(keys.privateKey),
		}
	}

	// When module gets deleted
	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
		this.shuttingDown = true
		this.clearReconnectTimer()
		this.teardownBridge()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		// this.log('debug', 'configUpdated')
		const prevConfig = this.config
		// this.log('debug', `Previous config: ${JSON.stringify(prevConfig)}`)
		this.config = config
		this.secrets = secrets
		// this.log('debug', `New config: ${JSON.stringify(this.config)}`)
		this.log('debug', this.config.host !== prevConfig.host ? 'host changed' : 'host unchanged')
		if (this.config.host !== prevConfig.host) {
			// host changed, need to re-pair
			this.updateStatus(InstanceStatus.Connecting, 'Pairing with Bridge')
			this.log('info', 'pairing...')
			await this.pairWithBridge()
		}

		this.saveConfig(this.config, this.secrets)
		this.log('debug', 're-initializing module')
		await this.init(this.config, false, this.secrets)
	}

	// Connect to the bridge, load devices and scenes, and subscribe to level changes.
	// On failure this schedules a retry itself, so callers need not.
	async connectToBridge(): Promise<boolean> {
		if (!this.config.bridgeID || !this.secrets.bridgeCerts) {
			this.log('warn', 'No bridge ID or certificates found in config/secrets')
			this.updateStatus(InstanceStatus.BadConfig, 'No valid configuration or pairing found')
			return false
		}

		this.clearReconnectTimer()
		this.teardownBridge()
		this.connecting = true
		this.lostWhileConnecting = false

		this.log('debug', 'Connecting to bridge with id: ' + this.config.bridgeID)
		this.updateStatus(InstanceStatus.Connecting, 'Connecting to Bridge')

		try {
			const leapClient = new LeapClient(
				this.config.host,
				LEAP_PORT,
				this.secrets.bridgeCerts.ca,
				this.secrets.bridgeCerts.privateKey,
				this.secrets.bridgeCerts.certificate,
			)
			try {
				await withTimeout(leapClient.connect(), CONNECT_TIMEOUT_MS, 'connection timed out')
			} catch (err) {
				leapClient.drain() // abandon the hanging socket
				throw err
			}

			this.bridge = new SmartBridge(this.config.bridgeID, leapClient)
			this.bridge.on('disconnected', () => this.handleConnectionLost('Connection to bridge lost'))

			await this.loadDevices()
			await this.loadAreaNames()
			await this.loadPicoButtons()
			await this.logZoneControlTypes()
			await this.loadScenes()
			this.updateVariableDefinitions()
			await this.startSubscriptions()

			if (this.lostWhileConnecting) throw new Error('connection dropped during setup')
		} catch (err: any) {
			this.connecting = false
			this.log('error', `Bridge connection failed: ${err.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, `Bridge connection failed: ${err.message}`)
			this.teardownBridge()
			this.scheduleReconnect()
			return false
		}

		this.connecting = false
		this.reconnectDelay = RECONNECT_INITIAL_MS
		this.startHealthCheck()
		this.log('debug', 'Loaded')
		this.updateStatus(InstanceStatus.Ok)
		return true
	}

	async loadDevices(): Promise<void> {
		this.devicesOnBridge = []
		this.picoDevices = []
		this.sceneButtons = []
		const devices = (await this.bridge?.getDeviceInfo()) ?? []
		devices.forEach((device) => {
			if (device instanceof Error) {
				this.log('error', `Error retrieving device: ${device.message}`)
				return
			} else if (this.config.bridgeID === UNKNOWN_BRIDGE_ID && device.DeviceType === 'SmartBridge') {
				// We found our bridge device, update config
				this.config.bridgeID = device.SerialNumber
				this.saveConfig(this.config, this.secrets)
			} else {
				this.log(
					'debug',
					`device ${device.Name}: DeviceType=${device.DeviceType} LocalZones=${JSON.stringify(device.LocalZones)}`,
				)
				if (isPicoDevice(device)) this.picoDevices.push(device) // remotes need not be assigned to a room
				if (device.AssociatedArea) {
					this.log('info', `${device.DeviceType} device found ${device.Name}.`)
					this.devicesOnBridge.push(device)
				}
			}
		})
	}

	async loadAreaNames(): Promise<void> {
		this.areaNames.clear()
		await Promise.all(
			this.devicesOnBridge.map(async (device) => {
				try {
					const response = await this.bridge?.getHref(device.AssociatedArea)
					const name = (response as OneAreaDefinition | undefined)?.Area?.Name
					if (name) this.areaNames.set(device.SerialNumber, name)
				} catch (err: any) {
					this.log('error', `Error getting area for device ${device.Name}: ${err.message}`)
				}
			}),
		)
	}

	// Read every button of every Pico. Only done when "Include Pico Remotes" is ticked.
	async loadPicoButtons(): Promise<void> {
		this.picoButtons = []
		this.picoPressed.clear()
		if (!this.config.includePicos || !this.bridge) return
		for (const device of this.picoDevices) {
			try {
				const groups = await this.bridge.getButtonGroupsFromDevice(device)
				for (const group of groups) {
					if (!('Buttons' in group)) continue
					const buttons = await this.bridge.getButtonsFromGroup(group)
					for (const button of buttons) {
						this.picoButtons.push({
							id: `${device.SerialNumber}_${button.ButtonNumber}`,
							href: button.href,
							deviceName: device.Name,
							buttonName: button.Name,
							label: picoButtonLabel(device, button.Name, button.ButtonNumber),
						})
					}
				}
			} catch (err: any) {
				this.log('warn', `Could not read buttons for ${device.Name}: ${err.message}`)
			}
		}
		this.log('info', `Found ${this.picoButtons.length} Pico button(s) on ${this.picoDevices.length} remote(s)`)
	}

	// Subscribe to each Pico button's events. Like zone subscriptions, these must be redone after a reconnect.
	async subscribePicoButtons(): Promise<void> {
		const client = this.bridge?.client
		if (!client) return
		for (const button of this.picoButtons) {
			const { response } = await client.subscribe(`${button.href}/status/event`, (resp) => {
				this.handlePicoEvent(button, resp.Body)
			})
			if (!response.Header.StatusCode?.isSuccessful()) {
				this.log('warn', `Subscription to ${button.label} refused: ${JSON.stringify(response.Header.StatusCode)}`)
			}
		}
	}

	handlePicoEvent(button: PicoButton, body: unknown): void {
		const eventType = parseButtonEvent(body)
		if (!eventType) return
		if (eventType === 'Press') this.picoPressed.set(button.id, true)
		else if (eventType === 'Release') this.picoPressed.set(button.id, false)
		this.lastPico = { device: button.deviceName, button: button.buttonName, event: eventType }
		this.publishPicoVariables()
		this.checkFeedbacks('pico_pressed')
	}

	publishPicoVariables(): void {
		if (!this.config.includePicos) return
		this.setVariableValues({
			last_pico_device: this.lastPico.device,
			last_pico_button: this.lastPico.button,
			last_pico_event: this.lastPico.event,
		})
	}

	// Lights that have a zone, i.e. everything that can report a level
	lightDevices(): DeviceDefinition[] {
		return this.devicesOnBridge.filter((device) => isLightDevice(device) && zoneHrefOf(device))
	}

	deviceLabel(device: DeviceDefinition): string {
		return `${this.areaNames.get(device.SerialNumber) ?? 'Unknown area'} ${device.Name}`
	}

	levelFor(serialNumber: string): number | undefined {
		const device = this.lightDevices().find((d) => d.SerialNumber === serialNumber)
		const href = device && zoneHrefOf(device)
		return href ? this.zoneLevels.get(href) : undefined
	}

	// Subscribe to zone status changes and read the current state once. Subscriptions end with the
	// socket, so this must be repeated after every reconnect.
	async startSubscriptions(): Promise<void> {
		const client = this.bridge?.client
		if (!client) return

		const { response } = await client.subscribe('/zone/status', (resp) => {
			this.log('debug', `/zone/status event: ${JSON.stringify(resp.Body)}`)
			this.handleZoneStatus(resp.Body)
		})
		if (!response.Header.StatusCode?.isSuccessful()) {
			throw new Error(`zone status subscription refused: ${JSON.stringify(response.Header.StatusCode)}`)
		}
		this.log('debug', `/zone/status subscribe response: ${JSON.stringify(response.Body)}`)
		this.handleZoneStatus(response.Body)

		// The subscribe response may not carry current state, so read it explicitly
		const seed = await client.request('ReadRequest', '/zone/status')
		this.log('debug', `/zone/status read response: ${JSON.stringify(seed.Body)}`)
		this.handleZoneStatus(seed.Body)
		this.log('info', `Subscribed to level changes for ${this.lightDevices().length} light(s)`)
		await this.subscribePicoButtons()
	}

	handleZoneStatus(body: unknown): void {
		const updates = parseZoneStatuses(body)
		if (updates.length === 0) return
		for (const { zoneHref, level } of updates) {
			this.zoneLevels.set(zoneHref, level)
		}
		this.publishLevels()
		this.checkFeedbacks('dimmer_on', 'dimmer_level')
	}

	publishLevels(): void {
		const values: CompanionVariableValues = {}
		for (const device of this.lightDevices()) {
			const level = this.levelFor(device.SerialNumber)
			if (level !== undefined) values[`${device.SerialNumber}_level`] = level
		}
		this.setVariableValues(values)
	}

	clearReconnectTimer(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = undefined
	}

	// Drop the bridge connection and stop its timers. Safe to call when not connected.
	teardownBridge(): void {
		if (this.healthTimer) clearInterval(this.healthTimer)
		this.healthTimer = undefined
		this.healthFailures = 0
		if (this.bridge) {
			const bridge = this.bridge
			this.bridge = undefined
			bridge.removeAllListeners()
			bridge.close()
			bridge.client.drain() // removes the client's listeners so the closing socket cannot trigger a reconnect
		}
	}

	// Called when the socket closes or the bridge stops answering
	handleConnectionLost(reason: string): void {
		if (this.shuttingDown || this.reconnectTimer) return
		if (this.connecting) {
			this.lostWhileConnecting = true
			return
		}
		this.log('warn', `${reason}; will reconnect`)
		this.updateStatus(InstanceStatus.ConnectionFailure, reason)
		this.teardownBridge()
		this.scheduleReconnect()
	}

	// Retry with a growing delay. A successful reconnect rebuilds devices, subscriptions and definitions.
	scheduleReconnect(): void {
		if (this.shuttingDown || this.reconnectTimer) return
		const delay = this.reconnectDelay
		this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS)
		this.log('info', `Reconnecting to bridge in ${delay / 1000}s`)
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			void this.connectToBridge().then(async (ok) => {
				if (!ok) return
				this.log('info', 'Reconnected to bridge')
				await this.updateActions()
				this.updateFeedbacks()
				this.updateVariableDefinitions()
			})
		}, delay)
	}

	// A half-open connection (e.g. bridge power cut) produces no close event, so ping periodically
	startHealthCheck(): void {
		if (this.healthTimer) clearInterval(this.healthTimer)
		this.healthFailures = 0
		this.healthTimer = setInterval(() => {
			void this.checkHealth()
		}, HEALTH_CHECK_INTERVAL_MS)
	}

	async checkHealth(): Promise<void> {
		const client = this.bridge?.client
		if (!client || this.connecting) return
		let timer: NodeJS.Timeout | undefined
		try {
			await Promise.race([
				client.ping(),
				new Promise((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error('ping timed out')), HEALTH_CHECK_TIMEOUT_MS)
				}),
			])
			if (this.healthFailures > 0) this.log('info', 'Bridge is responding again')
			this.healthFailures = 0
		} catch (err: any) {
			this.healthFailures++
			this.log('warn', `Bridge health check failed (${this.healthFailures}): ${err.message}`)
			if (this.healthFailures >= HEALTH_CHECK_MAX_FAILURES) {
				this.handleConnectionLost('Bridge not responding')
			}
		} finally {
			if (timer) clearTimeout(timer)
		}
	}

	// Diagnostic: log each zone's ControlType (e.g. dimmed or switched) so switch-mode dimmers can be identified
	async logZoneControlTypes(): Promise<void> {
		for (const device of this.devicesOnBridge) {
			const zoneHref = device.LocalZones?.[0]?.href
			if (!zoneHref) continue
			try {
				const response = await this.bridge?.client.request('ReadRequest', zoneHref)
				const zone = (response?.Body as { Zone?: { ControlType?: string } } | undefined)?.Zone
				this.log(
					'debug',
					`zone ${zoneHref} (${device.Name}, ${device.DeviceType}): ControlType=${zone?.ControlType} body=${JSON.stringify(response?.Body)}`,
				)
			} catch (err: any) {
				this.log('warn', `Could not read zone ${zoneHref} for ${device.Name}: ${err.message}`)
			}
		}
	}

	// Scenes are bridge-level virtual buttons. The bridge lists every slot (100 on a Smart Bridge),
	// so only those marked IsProgrammed are real scenes.
	async loadScenes(): Promise<void> {
		try {
			const response = await this.bridge?.client.request('ReadRequest', '/virtualbutton')
			this.log('debug', `/virtualbutton response: ${JSON.stringify(response?.Body)}`)
			const buttons = (
				response?.Body as { VirtualButtons?: { href: string; Name?: string; IsProgrammed?: boolean }[] } | undefined
			)?.VirtualButtons
			this.sceneButtons = (buttons ?? [])
				.filter((button) => button.href && button.Name && button.IsProgrammed === true)
				.map((button) => ({ href: button.href, name: button.Name as string }))
			this.log('info', `Found ${this.sceneButtons.length} scene(s)`)
		} catch (err: any) {
			this.log('warn', `Could not read scenes: ${err.message}`)
		}
	}

	// Return config fields for web config
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields(this.discoveredBridges)
	}

	async updateActions(): Promise<void> {
		await UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
		this.publishLevels()
		this.publishPicoVariables()
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
