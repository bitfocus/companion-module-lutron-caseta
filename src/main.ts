import { InstanceBase, runEntrypoint, InstanceStatus, SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { PairingClient, BridgeFinder, BridgeNetInfo, LeapClient, SmartBridge } from 'lutron-leap'
import forge from 'node-forge'

const PAIRING_PORT = 8083
const LEAP_PORT = 8081

export class ModuleInstance extends InstanceBase<ModuleConfig> {
	config!: ModuleConfig // Setup in init()
	discoveredBridges: Record<string, string>
	bridge?: SmartBridge

	constructor(internal: unknown) {
		super(internal)
		this.discoveredBridges = {}
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config

		if (this.config.host === undefined || this.config.host === '') {
			this.updateStatus(InstanceStatus.BadConfig, 'No Host/IP')
			return
		}

		if (!this.config.bridgeID) {
			// discover bridges (used for dropdown in config)
			await this.startDiscovery()
		}

		// pair and load certs
		if (this.config.host && !this.config.bridgeID) {
			this.updateStatus(InstanceStatus.Connecting, 'Pairing with Bridge')
			await this.pairWithBridge()
		}

		// if we have certs, connect to bridge
		if (this.config.ca && this.config.certificate && this.config.privateKey) {
			this.updateStatus(InstanceStatus.Connecting, 'Connecting to Bridge')

			const leapClient = new LeapClient(
				this.config.host,
				LEAP_PORT,
				this.config.ca,
				this.config.privateKey,
				this.config.certificate,
			)

			await leapClient.connect().catch((err) => {
				this.updateStatus(InstanceStatus.ConnectionFailure, `Bridge connection failed: ${err.message}`)
				this.log('error', `Bridge connection failed: ${err.message}`)
				return
			})

			const bridgeID = this.config.bridgeID || this.discoveredBridges[this.config.host]
			if (bridgeID) {
				this.bridge = new SmartBridge(bridgeID, leapClient)

				// if this is the first time connecting, save the bridgeID
				if (!this.config.bridgeID) {
					this.config.bridgeID = bridgeID
					this.saveConfig(this.config)
				}
				const devices = await this.bridge.getDeviceInfo()
				devices.forEach((device) => {
					this.log('info', `Found device: ${device.Name} (model: ${device.ModelNumber}, Type: ${device.DeviceType})`)
				})
			} else {
				// anything to do here? We have an unpaired host
				this.log('warn', 'No valid bridge id found for configured host. Resetting certificates to repair')
				this.config.certificate = undefined
				this.config.privateKey = undefined
				this.config.ca = undefined
				this.saveConfig(this.config)
				this.updateStatus(InstanceStatus.Disconnected, 'No Bridge ID for Paired Host')
				return
			}

			this.updateStatus(InstanceStatus.Ok)
		}

		// refactor into separate function that returns the bridge info?
		/**
		 *  got cert request result {"Header":{"StatusCode":"200 OK","ClientTag":"get-cert","ContentType":"signing-result;plurality=single","CorrelationID":"9b07585b-8cc8-4eec-ac03-e2e1a8d4d9bd"},"Body":{"SigningResult":{"Certificate":"-----BEGIN CERTIFICATE-----\nMIIC6TCCAo6gAwIBAgIBATAKBggqhkjOPQQDAjCBgzELMAkGA1UEBhMCVVMxFTAT\nBgNVBAgTDFBlbm5zeWx2YW5pYTEUMBIGA1UEBxMLQ29vcGVyc2J1cmcxJTAjBgNV\nBAoTHEx1dHJvbiBFbGVjdHJvbmljcyBDby4sIEluYy4xIDAeBgNVBAMTF1NtYXJ0\nQnJpZGdlNTA4Q0IxMjE4Q0Q3MB4XDTE1MTAzMTAwMDAwMFoXDTM1MTAyNjAwMDAw\nMFowazEnMCUGA1UEAxMeY29tcGFuaW9uLW1vZHVsZS1sdXRyb24tY2FzZXRhMRww\nGgYKKwYBBAGCuQkBAhMMMDAwMDAwMDAwMDAwMSIwIAYKKwYBBAGCuQkBAwwSZ2V0\nX2x1dHJvbl9jZXJ0LnB5MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n26VhRo40yomhWf7Mo1FZQsz3NcpRM5qdpqAdSQJspyJ+M9rXVTO+nTTM4Yg1izPj\npVR1W3w4ePvA4YHJ2X4u2Kq31okuULD5PUvjY3GHVCqnO7/a9MHigHgASwdw6KS5\naqtITeSlbFMIuLjwQVC8ZxThzstv8MDXmVrZNVDoOfSmO8Yy6T/UKb7oTPxmCUia\ndmGMa98L/nkZWZGk3ugWe9DNFkjyE9grqGRilzLaLLrHuSSWiOrXEirxp3ewP4au\ntWyKSlQDhLQt+re/RrYnNIMkkUMGVSImOBJuaUHkVinYWrd4/lPmNdvfZwQI27Ko\nGVDKBMR8wEwjMJUGYl1anQIDAQABoz8wPTAOBgNVHQ8BAf8EBAMCBaAwHQYDVR0l\nBBYwFAYIKwYBBQUHAwEGCCsGAQUFBwMCMAwGA1UdEwEB/wQCMAAwCgYIKoZIzj0E\nAwIDSQAwRgIhALBvB7v2lXgbzQ0CpFGZMcMmR0fJIiSkG1FnPMYSxjAIAiEAyyP4\nzOTJnzFrkpDWfGhVqgtozyQdddGWt8sVf4HSdPc=\n-----END CERTIFICATE-----\n","RootCertificate":"-----BEGIN CERTIFICATE-----\nMIICGjCCAcCgAwIBAgIBATAKBggqhkjOPQQDAjCBgzELMAkGA1UEBhMCVVMxFTAT\nBgNVBAgTDFBlbm5zeWx2YW5pYTEUMBIGA1UEBxMLQ29vcGVyc2J1cmcxJTAjBgNV\nBAoTHEx1dHJvbiBFbGVjdHJvbmljcyBDby4sIEluYy4xIDAeBgNVBAMTF1NtYXJ0\nQnJpZGdlNTA4Q0IxMjE4Q0Q3MB4XDTE1MTAzMTAwMDAwMFoXDTM1MTAyNjAwMDAw\nMFowgYMxCzAJBgNVBAYTAlVTMRUwEwYDVQQIEwxQZW5uc3lsdmFuaWExFDASBgNV\nBAcTC0Nvb3BlcnNidXJnMSUwIwYDVQQKExxMdXRyb24gRWxlY3Ryb25pY3MgQ28u\nLCBJbmMuMSAwHgYDVQQDExdTbWFydEJyaWRnZTUwOENCMTIxOENENzBZMBMGByqG\nSM49AgEGCCqGSM49AwEHA0IABBjBi3p+EEIsfhOmY2n0PAYjtN/gNP8ASn/1N/dV\nM6jmtRcWsCTR9O2LTvXF3wmW0+RD4S2qsqZTffUshXnZUr2jIzAhMA4GA1UdDwEB\n/wQEAwIBvjAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIQCyYhuv\nD9t3eLBSoxXQ2D8QnVVW3WSyLKs2zyB83TOEXgIgC4SMueL1W5LNrqSHZVk741Z1\nzP82q2TLMD/5C5ilY/E=\n-----END CERTIFICATE-----\n"}}}
		 */
		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
	}

	async startDiscovery(): Promise<void> {
		const bridgeFinder = new BridgeFinder()
		bridgeFinder.on('discovered', (bridgeInfo: BridgeNetInfo) => {
			this.discoveredBridges[bridgeInfo.ipAddr] = bridgeInfo.bridgeid
			this.log('info', `Discovered Bridge ${bridgeInfo.bridgeid} at ${bridgeInfo.ipAddr}`)
		})
		bridgeFinder.beginSearching()
	}

	async pairWithBridge(): Promise<void> {
		const client = new PairingClient(this.config.host, PAIRING_PORT)
		try {
			await client.connect()
			this.log('debug', 'Pairing client connected')
		} catch (e: any) {
			this.updateStatus(InstanceStatus.ConnectionFailure, `Failed to initialize pairing: ${e.message}`)
			this.log('error', `Failed to initialize pairing: ${e.message}`)
			return
		}

		// wait for pairing button to be pressed on bridge
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
		this.config.ca = certResult.Body.SigningResult.RootCertificate
		this.config.certificate = certResult.Body.SigningResult.Certificate
		this.config.privateKey = forge.pki.privateKeyToPem(keys.privateKey)
		this.saveConfig(this.config)
	}

	// When module gets deleted
	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
	}

	// Return config fields for web config
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields(this.discoveredBridges)
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
