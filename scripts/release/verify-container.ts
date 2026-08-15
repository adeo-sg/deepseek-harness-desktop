/** Static validation for the checked-in Docker and Kubernetes deployment assets. */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

function fail(message: string): never {
  throw new Error(`container verify: ${message}`)
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) fail(message)
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${path} is not an object`)
  return value as Record<string, unknown>
}

function readDocuments(path: string): Record<string, unknown>[] {
  const documents: Record<string, unknown>[] = []
  yaml.loadAll(readFileSync(path, 'utf8'), (document: unknown) => {
    if (document === undefined) return
    documents.push(objectValue(document, path))
  })
  return documents
}

function readDocument(path: string): Record<string, unknown> {
  const document = readDocuments(path)[0]
  if (document === undefined) fail(`${path} has no YAML document`)
  return document
}

function readVersion(): string {
  const manifest = objectValue(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')), 'package.json')
  const version = manifest.version
  if (typeof version !== 'string' || version === '') fail('package.json has no version')
  return version
}

function scalarArray(value: unknown, path: string): unknown[] {
  assert(Array.isArray(value), `${path} is not an array`)
  return value
}

function onlyObject(value: unknown, path: string): Record<string, unknown> {
  const entries = scalarArray(value, path)
  assert(entries.length === 1, `${path} must contain exactly one entry`)
  return objectValue(entries[0], `${path}[0]`)
}

function namedHttpProbe(container: Record<string, unknown>, name: string): void {
  const probe = objectValue(container[name], `deployment.container.${name}`)
  const httpGet = objectValue(probe.httpGet, `deployment.container.${name}.httpGet`)
  assert(httpGet.path === '/', `${name} must request /`)
  assert(httpGet.port === 'http', `${name} must use the named http port`)
}

function expectEntrypointUsageError(environment: Record<string, string>, message: string): void {
  const result = spawnSync(process.execPath, [join(ROOT, 'deploy/docker-entrypoint.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  })
  assert(result.status === 64, `entrypoint usage error must exit 64, got ${String(result.status)}`)
  assert(result.stderr.includes(message), `entrypoint usage error must contain ${JSON.stringify(message)}`)
}

function main(): void {
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
  const dockerInstructions = dockerfile.replace(/^\s*#.*$/gm, '')
  const dockerignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8')
  const entrypoint = readFileSync(join(ROOT, 'deploy/docker-entrypoint.mjs'), 'utf8')
  const releaseWorkflow = readFileSync(join(ROOT, '.github/workflows/container-release.yml'), 'utf8')
  const releaseWorkflowDocument = objectValue(yaml.load(releaseWorkflow), '.github/workflows/container-release.yml')
  const compose = objectValue(yaml.load(readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8')), 'docker-compose.yml')
  const kustomization = objectValue(yaml.load(readFileSync(join(ROOT, 'deploy/kubernetes/kustomization.yaml'), 'utf8')), 'kustomization')
  const deployment = readDocument(join(ROOT, 'deploy/kubernetes/deployment.yaml'))
  const service = readDocument(join(ROOT, 'deploy/kubernetes/service.yaml'))
  const config = readDocument(join(ROOT, 'deploy/kubernetes/configmap.yaml'))
  const networkPolicy = readDocument(join(ROOT, 'deploy/kubernetes/network-policy.yaml'))
  const ingressExample = readDocument(join(ROOT, 'deploy/kubernetes/ingress.example.yaml'))
  const version = readVersion()

  for (const path of ['.dockerignore', '.github/workflows/container-release.yml', 'Dockerfile', 'docker-compose.yml', 'deploy/docker-entrypoint.mjs', 'deploy/kubernetes/kustomization.yaml', 'deploy/kubernetes/configmap.yaml', 'deploy/kubernetes/pvc.yaml', 'deploy/kubernetes/deployment.yaml', 'deploy/kubernetes/service.yaml', 'deploy/kubernetes/network-policy.yaml', 'deploy/kubernetes/secret.example.yaml', 'deploy/kubernetes/ingress.example.yaml']) {
    assert(existsSync(join(ROOT, path)), `missing ${path}`)
  }

  assert(!/\bpnpm\s+deploy\b/.test(dockerInstructions), 'Dockerfile must not use pnpm deploy for the standalone runtime')
  const buildIndex = dockerfile.indexOf('pnpm run build')
  const dshPackIndex = dockerfile.indexOf('release:pack --family dsh')
  const vendorPackIndex = dockerfile.indexOf('release:pack --family vendor')
  const landlockPackIndex = dockerfile.indexOf('native/landlock-run/packages/entry pack')
  const npmInstallIndex = dockerfile.indexOf('npm install --no-audit --no-fund --package-lock=false')
  const landlockSmokeIndex = dockerfile.indexOf('accessSync(launcherPath(), constants.X_OK)')
  const smokeIndex = dockerfile.indexOf('node node_modules/@deepseek-ai/dsh/lib/bin.js --version')
  assert(buildIndex !== -1, 'Dockerfile must build the workspace')
  assert(dshPackIndex > buildIndex, 'Dockerfile must pack the dsh family after the build')
  assert(vendorPackIndex > dshPackIndex, 'Dockerfile must pack the vendor family after dsh')
  assert(landlockPackIndex > vendorPackIndex, 'Dockerfile must pack the Landlock entry after vendor')
  assert(npmInstallIndex > landlockPackIndex, 'Dockerfile must install the packed runtime after packing')
  assert(landlockSmokeIndex > npmInstallIndex, 'Dockerfile must verify the installed platform Landlock launcher')
  assert(smokeIndex > landlockSmokeIndex, 'Dockerfile must smoke the installed CLI after npm install')
  assert(dockerfile.includes('/packs/dsh/*.tgz /packs/vendor/*.tgz /packs/landlock/*.tgz'), 'Dockerfile must install every packed release family')
  assert(!dockerfile.includes('--omit=optional'), 'Dockerfile must install the Landlock entry platform dependency')
  assert(/EXPOSE\s+4080\b/.test(dockerfile), 'Dockerfile must expose 4080')
  assert(dockerfile.includes('DSH_WEB_PORT=4080'), 'Dockerfile must default DSH_WEB_PORT to 4080')
  assert(dockerfile.includes('127.0.0.1:4080'), 'Dockerfile healthcheck must use 4080')
  assert(dockerfile.includes('USER 10001:10001'), 'Dockerfile must run as the non-root runtime user')
  assert(dockerfile.includes('bubblewrap'), 'Dockerfile must install bubblewrap for the default sandbox')
  assert(dockerfile.includes('npm install --global --no-audit --no-fund pnpm@11.7.0'), 'Dockerfile must install the plugin manager in the runtime image')
  assert(dockerfile.includes('XDG_CACHE_HOME=/data/.cache'), 'Dockerfile must keep runtime package-manager caches on the writable data volume')
  assert(!dockerignore.split(/\r?\n/).some(line => /^native(?:\/|\/\*\*)?$/.test(line.trim())), '.dockerignore must include the native Landlock sources')
  assert(entrypoint.includes('process.env.DSH_WEB_PORT ?? \'4080\''), 'entrypoint must default DSH_WEB_PORT to 4080')
  assert(entrypoint.includes('host !== \'0.0.0.0\' && allowNonLoopback'), 'entrypoint must reject a non-loopback opt-in for another host')
  assert(entrypoint.includes('/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'), 'entrypoint must start the packed npm consumer CLI')
  assert(releaseWorkflowDocument.name === 'Release (container)', 'release workflow must have the expected name')
  const qemuIndex = releaseWorkflow.indexOf('docker/setup-qemu-action@v3')
  const buildxIndex = releaseWorkflow.indexOf('docker/setup-buildx-action@v3')
  assert(qemuIndex !== -1 && qemuIndex < buildxIndex, 'release workflow must register QEMU before the multi-platform Buildx builder')
  assert(releaseWorkflow.includes('pnpm run release:pack-container --out dist/container --image-repository "ghcr.io/${GITHUB_REPOSITORY_OWNER}/deepseek-harness"'), 'release workflow must package manifests for the image repository it publishes')
  assert(releaseWorkflow.includes('docker run --detach --name'), 'release workflow must start the built image before publishing it')
  assert(releaseWorkflow.includes('--jq \'.visibility\''), 'release workflow must require a public GHCR package')
  assert(releaseWorkflow.includes('docker logout ghcr.io') && releaseWorkflow.includes('docker pull "ghcr.io/${GITHUB_REPOSITORY_OWNER}/deepseek-harness:'), 'release workflow must prove an anonymous image pull')
  assert(releaseWorkflow.includes('if: startsWith(github.ref, \'refs/tags/dsh-v\')'), 'release workflow must attach bundles only for dsh version tags')
  assert((releaseWorkflow.match(/if: startsWith\(github\.ref, 'refs\/tags\/dsh-v'\)/g) ?? []).length >= 5, 'release workflow must gate registry writes, digest recording, and release attachment on dsh version tags')
  assert(releaseWorkflow.includes('softprops/action-gh-release@v2'), 'release workflow must retain tagged deployment bundles on GitHub Releases')
  assert(releaseWorkflow.includes('artifacts/*.tar.gz') && releaseWorkflow.includes('artifacts/*.tar.gz.sha256'), 'GitHub Releases must carry the deployment archive and its SHA-256 checksum')

  const dsh = objectValue(compose.services, 'docker-compose.services').dsh
  const composeService = objectValue(dsh, 'docker-compose.services.dsh')
  assert(composeService.image === '${DSH_IMAGE:-ghcr.io/sdkwork-ai/deepseek-harness:local}', 'Compose image must match the current GHCR repository')
  const ports = scalarArray(composeService.ports, 'docker-compose.services.dsh.ports')
  assert(ports.length === 1 && ports[0] === '${DSH_PUBLISH_HOST:-127.0.0.1}:${DSH_PUBLISH_PORT:-4080}:4080', 'Compose must publish 4080 on loopback by default')
  const composeEnvironment = objectValue(composeService.environment, 'docker-compose.services.dsh.environment')
  assert(composeEnvironment.DSH_WEB_HOST === '0.0.0.0', 'Compose must bind the container to all interfaces')
  assert(composeEnvironment.DSH_WEB_PORT === '4080', 'Compose must set DSH_WEB_PORT to 4080')
  assert(composeEnvironment.DSH_ALLOW_NON_LOOPBACK === '1', 'Compose must explicitly opt into non-loopback binding')

  assert(deployment.kind === 'Deployment', 'deployment.yaml must contain a Deployment')
  const podSpec = objectValue(objectValue(objectValue(deployment.spec, 'deployment.spec').template, 'deployment.spec.template').spec, 'deployment.spec.template.spec')
  assert(podSpec.automountServiceAccountToken === false, 'Deployment must not expose a Kubernetes API token to the agent runtime')
  const containers = podSpec.containers
  assert(Array.isArray(containers) && containers.length === 1, 'Deployment must define one container')
  const container = objectValue(containers[0], 'deployment.container')
  assert(container.image === `ghcr.io/sdkwork-ai/deepseek-harness:${version}`, 'Deployment image tag must match package.json')
  const containerPort = onlyObject(container.ports, 'deployment.container.ports')
  assert(containerPort.name === 'http' && containerPort.protocol === 'TCP' && containerPort.containerPort === 4080, 'Deployment must expose exactly http/TCP/4080')
  assert(objectValue(container.securityContext, 'deployment.container.securityContext').readOnlyRootFilesystem === true, 'Deployment root filesystem must be read-only')
  const envFrom = container.envFrom
  assert(Array.isArray(envFrom) && envFrom.length > 0, 'Deployment must load the ConfigMap')
  namedHttpProbe(container, 'startupProbe')
  namedHttpProbe(container, 'readinessProbe')
  namedHttpProbe(container, 'livenessProbe')

  assert(service.kind === 'Service', 'service.yaml must contain a Service')
  const servicePort = onlyObject(objectValue(service.spec, 'service.spec').ports, 'service.spec.ports')
  assert(servicePort.name === 'http' && servicePort.protocol === 'TCP' && servicePort.port === 4080 && servicePort.targetPort === 'http', 'Service must publish exactly http/TCP/4080 to targetPort http')

  const configData = objectValue(config.data, 'configmap.data')
  assert(configData.DSH_WEB_PORT === '4080', 'ConfigMap must set DSH_WEB_PORT to 4080')
  assert(configData.DSH_ALLOW_NON_LOOPBACK === '1', 'ConfigMap must explicitly opt into non-loopback binding')

  const images = kustomization.images
  assert(Array.isArray(images) && images.some((value) => {
    const image = objectValue(value, 'kustomization.image')
    return image.name === 'ghcr.io/sdkwork-ai/deepseek-harness' && image.newTag === version
  }), 'Kustomization image override must match the current GHCR repository and package.json')
  const resources = scalarArray(kustomization.resources, 'kustomization.resources')
  assert(resources.includes('network-policy.yaml'), 'Kustomization must include network-policy.yaml')

  assert(networkPolicy.kind === 'NetworkPolicy', 'network-policy.yaml must contain a NetworkPolicy')
  const networkSpec = objectValue(networkPolicy.spec, 'network-policy.spec')
  const matchLabels = objectValue(objectValue(networkSpec.podSelector, 'network-policy.spec.podSelector').matchLabels, 'network-policy.spec.podSelector.matchLabels')
  assert(matchLabels['app.kubernetes.io/name'] === 'dsh', 'NetworkPolicy must select dsh pods')
  const policyTypes = scalarArray(networkSpec.policyTypes, 'network-policy.spec.policyTypes')
  assert(policyTypes.includes('Ingress') && policyTypes.includes('Egress'), 'NetworkPolicy must declare Ingress and Egress policy types')
  const networkIngress = onlyObject(networkSpec.ingress, 'network-policy.spec.ingress')
  const ingressPort = onlyObject(networkIngress.ports, 'network-policy.spec.ingress[0].ports')
  assert(ingressPort.protocol === 'TCP' && ingressPort.port === 4080, 'NetworkPolicy must admit TCP/4080')

  const ingressMetadata = objectValue(ingressExample.metadata, 'ingress.metadata')
  const ingressAnnotations = objectValue(ingressMetadata.annotations, 'ingress.metadata.annotations')
  assert(ingressAnnotations['nginx.ingress.kubernetes.io/auth-type'] === 'basic', 'Ingress example must require basic authentication')
  assert(ingressAnnotations['nginx.ingress.kubernetes.io/auth-secret'] === 'dsh-basic-auth', 'Ingress example must name its authentication Secret')

  expectEntrypointUsageError({ DSH_WEB_HOST: '0.0.0.0', DSH_ALLOW_NON_LOOPBACK: '0' }, 'DSH_ALLOW_NON_LOOPBACK must be true')
  expectEntrypointUsageError({ DSH_WEB_HOST: '127.0.0.1', DSH_ALLOW_NON_LOOPBACK: '1' }, 'DSH_ALLOW_NON_LOOPBACK is valid only')
  console.log(`container verify: Docker, Compose, and Kubernetes assets are valid for ${version}`)
}

main()
