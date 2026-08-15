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
  const deploymentGuide = readFileSync(join(ROOT, 'docs/user/guide/deployment.md'), 'utf8')
  const releaseWorkflow = readFileSync(join(ROOT, '.github/workflows/container-release.yml'), 'utf8')
  const releaseWorkflowDocument = objectValue(yaml.load(releaseWorkflow), '.github/workflows/container-release.yml')
  const compose = objectValue(yaml.load(readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8')), 'docker-compose.yml')
  const kustomization = objectValue(yaml.load(readFileSync(join(ROOT, 'deploy/kubernetes/kustomization.yaml'), 'utf8')), 'kustomization')
  const deployment = readDocument(join(ROOT, 'deploy/kubernetes/deployment.yaml'))
  const service = readDocument(join(ROOT, 'deploy/kubernetes/service.yaml'))
  const config = readDocument(join(ROOT, 'deploy/kubernetes/configmap.yaml'))
  const networkPolicy = readDocument(join(ROOT, 'deploy/kubernetes/network-policy.yaml'))
  const ingressExample = readDocument(join(ROOT, 'deploy/kubernetes/ingress.example.yaml'))
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
  assert(dockerfile.includes('ELECTRON_SKIP_BINARY_DOWNLOAD=1'), 'Dockerfile must not download the desktop Electron runtime for the Web image')
  assert(dockerfile.includes('NARB_DISABLE_NATIVE_CACHE=1'), 'Dockerfile must load the Node-internals helper from its installed path because Compose /tmp is noexec')
  assert(!dockerignore.split(/\r?\n/).some(line => /^native(?:\/|\/\*\*)?$/.test(line.trim())), '.dockerignore must include the native Landlock sources')
  assert(entrypoint.includes('process.env.DSH_WEB_PORT ?? \'4080\''), 'entrypoint must default DSH_WEB_PORT to 4080')
  assert(entrypoint.includes('host !== \'0.0.0.0\' && allowNonLoopback'), 'entrypoint must reject a non-loopback opt-in for another host')
  assert(entrypoint.includes('/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'), 'entrypoint must start the packed npm consumer CLI')
  assert(deploymentGuide.includes('git clone https://github.com/sdkwork-ai/deepseek-harness-desktop.git'), 'deployment guide must include the source-clone path')
  assert(deploymentGuide.includes('docker save --output dsh-container-local.tar localhost/deepseek-harness:local'), 'deployment guide must save the source image before loading a local cluster')
  assert(deploymentGuide.includes('minikube image load dsh-container-local.tar'), 'deployment guide must load the source archive into Minikube')
  assert(deploymentGuide.includes('minikube image load "dsh-container-image-${version}-linux-amd64.tar"'), 'deployment guide must load the Release archive into Minikube')
  assert(deploymentGuide.includes('docker compose up -d --wait --wait-timeout 180'), 'deployment guide must wait for the offline Compose deployment')
  assert(deploymentGuide.includes('kubectl port-forward svc/dsh 4081:4080'), 'deployment guide must keep the Kubernetes port-forward distinct from Docker and npx')
  assert(releaseWorkflowDocument.name === 'Release (container)', 'release workflow must have the expected name')
  const workflowPermissions = objectValue(releaseWorkflowDocument.permissions, 'release workflow permissions')
  assert(workflowPermissions.contents === 'read', 'release workflow must default to read-only repository access')
  const workflowJobs = objectValue(releaseWorkflowDocument.jobs, 'release workflow jobs')
  const packageJob = objectValue(workflowJobs.package, 'release workflow package job')
  assert(packageJob.permissions === undefined, 'package job must not override the read-only workflow permissions')
  assert(packageJob['timeout-minutes'] === 25, 'package job must have a bounded runtime')
  const releaseJob = objectValue(workflowJobs.release, 'release workflow release job')
  const releasePermissions = objectValue(releaseJob.permissions, 'release workflow release permissions')
  assert(releaseJob.needs === 'package' && releasePermissions.contents === 'write', 'only the release job may receive repository write access')
  assert((releaseWorkflow.match(/contents: write/g) ?? []).length === 1, 'release workflow must grant repository write access exactly once')
  assert(releaseWorkflow.includes('docker/setup-buildx-action@v3'), 'release workflow must configure Buildx')
  assert(!releaseWorkflow.includes('docker/setup-qemu-action'), 'release workflow must not emulate another architecture')
  assert(releaseWorkflow.includes('pnpm run release:pack-container --out dist/container --image-repository localhost/deepseek-harness'), 'release workflow must package manifests for the saved local image')
  assert(releaseWorkflow.includes('docker buildx build') && releaseWorkflow.includes('--platform linux/amd64'), 'release workflow must build one amd64 image archive')
  assert(releaseWorkflow.includes('--output "type=docker,dest=dist/container/${image_tar}"'), 'release workflow must write the image directly as an offline Docker archive')
  assert(!releaseWorkflow.includes('linux/arm64') && !releaseWorkflow.includes('push: true'), 'release workflow must not run a multi-platform registry push')
  assert(!releaseWorkflow.includes('docker/build-push-action') && !releaseWorkflow.includes('cache-to:'), 'release workflow must not use an image-publishing action or upload a BuildKit cache')
  assert(!releaseWorkflow.includes('packages: write') && !releaseWorkflow.includes('ghcr.io') && !releaseWorkflow.includes('docker login'), 'release workflow must not request or use registry publishing access')
  const outputIndex = releaseWorkflow.indexOf('--output "type=docker,dest=dist/container/${image_tar}"')
  const gzipIndex = releaseWorkflow.indexOf('gzip -n "dist/container/$image_tar"')
  const loadIndex = releaseWorkflow.indexOf('| docker load')
  const workflowSmokeIndex = releaseWorkflow.indexOf('docker compose --project-name "$project" --file "$compose_file" up --detach --wait')
  assert(outputIndex !== -1 && outputIndex < gzipIndex && gzipIndex < loadIndex && loadIndex < workflowSmokeIndex, 'release workflow must health-check the archived image through packaged Compose')
  assert(!releaseWorkflow.includes('docker run --detach'), 'release workflow must not replace the hardened Compose smoke with a plain container run')
  assert(releaseWorkflow.includes('dsh-container-${{ steps.version.outputs.version }}/docker-compose.yml'), 'release workflow must smoke the packaged Compose file')
  assert(releaseWorkflow.includes('down --volumes --remove-orphans'), 'release workflow must clean up its Compose volumes')
  assert(releaseWorkflow.includes('/data/.release-smoke-marker'), 'release workflow must verify data-volume persistence across restart')
  assert(releaseWorkflow.includes('image_tar="dsh-container-image-${RELEASE_VERSION}-linux-amd64.tar"'), 'release workflow must name the image archive by version and platform')
  assert(releaseWorkflow.includes('sha256sum --check'), 'release workflow must verify the image archive checksum before the smoke test')
  assert(releaseWorkflow.includes('Verify and extract deployment archive'), 'release workflow must verify the deployment archive before the smoke test')
  assert(releaseWorkflow.includes('release:verify-container-bundle'), 'release workflow must verify the extracted deployment manifest')
  assert(releaseWorkflow.includes('dist/container/extracted/dsh-container-${{ steps.version.outputs.version }}/docker-compose.yml'), 'release workflow must smoke Compose from the extracted deployment archive')
  assert(releaseWorkflow.includes("if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/dsh-v')"), 'release workflow must attach bundles only for pushed dsh version tags')
  assert(releaseWorkflow.includes('actions/upload-artifact@v4') && releaseWorkflow.includes('compression-level: 0'), 'release workflow must retain the pre-compressed assets without recompressing them')
  assert(releaseWorkflow.includes('actions/download-artifact@v4'), 'release job must consume the read-only package job output')
  assert(releaseWorkflow.includes('softprops/action-gh-release@v2'), 'release workflow must retain tagged deployment bundles on GitHub Releases')
  assert(releaseWorkflow.includes('dist/container/*.tar.gz') && releaseWorkflow.includes('dist/container/*.tar.gz.sha256'), 'Actions artifacts must carry the image and deployment archives with their SHA-256 checksums')
  assert(releaseWorkflow.includes('artifacts/*.tar.gz') && releaseWorkflow.includes('artifacts/*.tar.gz.sha256'), 'GitHub Releases must carry the image and deployment archives with their SHA-256 checksums')

  const dsh = objectValue(compose.services, 'docker-compose.services').dsh
  const composeService = objectValue(dsh, 'docker-compose.services.dsh')
  assert(composeService.image === '${DSH_IMAGE:-localhost/deepseek-harness:local}', 'Compose must use the local source-build image by default')
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
  assert(container.image === 'localhost/deepseek-harness:local', 'Deployment must use the local source-build image by default')
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
    return image.name === 'localhost/deepseek-harness' && image.newTag === 'local'
  }), 'Kustomization image override must preserve the local source-build image')
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
  console.log('container verify: Docker, Compose, Kubernetes, and release assets are valid')
}

main()
