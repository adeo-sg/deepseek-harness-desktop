# Deploy the Web UI

English | [中文](deployment.zh.md)

This guide deploys the Web profile in Docker or Kubernetes. The npx/local runner keeps its default `http://127.0.0.1:3080`; container deployments use port `4080`, so both modes can run on one machine without a port collision.

## Port and trust

The Web server binds `127.0.0.1:3080` by default. A network-facing deployment must set `DSH_WEB_HOST=0.0.0.0`, `DSH_WEB_PORT=4080`, and `DSH_ALLOW_NON_LOOPBACK=1`; the container entrypoint converts those values to `--host 0.0.0.0 --port 4080 --allow-non-loopback`.

`DSH_TRUSTED_HOSTS` is a comma-separated list of browser `Host` authorities, such as `app.example.com` or `app.example.com:8443`. It protects the `/api` browser trust fence but does not provide authentication, TLS, or an origin policy. Put the service behind an authenticated, TLS-terminating reverse proxy or Ingress.

## Docker

### Build an image

Build from the repository root. The multi-stage image compiles and packs the workspace, installs the same npm tarball set exercised by the release verifier into an ordinary npm consumer, verifies the installed CLI and architecture-specific Landlock launcher, installs bubblewrap and the pinned pnpm version used by `dsh plugin`, and runs as UID 10001. Package-manager data and caches live under the writable `/data` volume.

```sh
docker build -t localhost/deepseek-harness:local .
```

### Run with Compose

Set `DEEPSEEK_API_KEY` in the shell and optionally set `DSH_TRUSTED_HOSTS` before starting Compose. The direct listener defaults to `127.0.0.1:4080`; change `DSH_PUBLISH_PORT` only when another process already owns that host port. Keep `DSH_PUBLISH_HOST` on loopback unless an authenticated reverse proxy protects the published listener.

```sh
DEEPSEEK_API_KEY=your-key DSH_TRUSTED_HOSTS=localhost,127.0.0.1 docker compose up -d --build
```

That command builds from a source checkout. A GitHub Release provides a saved `linux/amd64` image, its deployment bundle, and one SHA-256 file for each archive. Download all four assets into one directory, verify and load the image, then extract and start the deployment bundle. The packaged Compose file has no source-only build section and uses the image tag restored by `docker load`; `DSH_IMAGE` may override that tag.

```sh
sha256sum -c dsh-container-image-<version>-linux-amd64.tar.gz.sha256
sha256sum -c dsh-container-<version>.tar.gz.sha256
gzip -dc dsh-container-image-<version>-linux-amd64.tar.gz | docker load
tar -xzf dsh-container-<version>.tar.gz
cd dsh-container-<version>
DEEPSEEK_API_KEY=your-key docker compose up -d
```

Open `http://127.0.0.1:4080`. The named `dsh-data` volume stores `$DSH_HOME`; `dsh-workspace` stores the default agent workspace. The image health check requests `/`, which is served after the Web profile has mounted.

## Kubernetes

The manifests create one replica, two `ReadWriteOnce` claims, a ClusterIP Service, a NetworkPolicy, and HTTP startup/readiness/liveness probes. The checked-in manifests use `localhost/deepseek-harness:local`; the release bundle uses the versioned tag restored from its sibling image archive. Load that exact image into every target node before applying the kustomization. For local clusters, `kind load docker-image localhost/deepseek-harness:<version>` or `minikube image load localhost/deepseek-harness:<version>` imports an image already loaded into Docker.

Create the API key as a Secret before applying the kustomization.

```sh
kubectl create secret generic dsh-credentials \
  --from-literal=DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY"
kubectl apply -k deploy/kubernetes
kubectl port-forward svc/dsh 4080:4080
```

Open `http://127.0.0.1:4080` after the port-forward is ready. The port-forward uses `4080`; the npx/local runner remains on `3080`.

For a cluster that cannot accept a preloaded image, push the loaded image to a registry you control and replace the local image name from the extracted deployment bundle root before applying it.

```sh
docker tag localhost/deepseek-harness:<version> registry.example.com/deepseek-harness:<version>
docker push registry.example.com/deepseek-harness:<version>
cd deploy/kubernetes
kustomize edit set image localhost/deepseek-harness=registry.example.com/deepseek-harness:<version>
kubectl apply -k .
```

For an external URL, edit `deploy/kubernetes/configmap.yaml` so `DSH_TRUSTED_HOSTS` contains the exact Ingress authority. The optional NGINX `ingress.example.yaml` requires a `dsh-basic-auth` Secret whose `auth` key contains an htpasswd file and a `dsh-tls` TLS Secret; create both before applying the example and restarting the Deployment. Another Ingress controller must provide equivalent authentication and TLS. The Ingress must preserve WebSocket upgrades for the `/api` downlinks.

## Persistent data

Mount `/data` at `$DSH_HOME` and `/workspace` at the workspace root. The data claim contains sessions, attachments, settings, credentials, storage projections, profiles, and agent presets. Do not bake credentials into an image or a ConfigMap; inject `DEEPSEEK_API_KEY` through a Secret or the environment.

The Deployment uses `Recreate` because the JSONL session and storage files are local to one replica. Scale-out requires a shared storage and an application-level ownership design; the manifests do not provide that coordination.

## Security and operations

The Web carrier has no built-in TLS or authentication. Use an Ingress or reverse proxy with authentication, TLS, request limits, and an access policy before exposing it outside a trusted network. Keep `DSH_PERMISSION_MODE=workspace-write`; `danger-full-access` removes the file-effect restriction and is not a container hardening setting.

The image is read-only except for `/data`, `/workspace`, and an in-memory `/tmp`. It carries `bash`, bubblewrap, and the matching Landlock launcher; the sandbox selects a usable enforcing backend. A host that supports neither bubblewrap user namespaces nor Landlock makes shell tools fail closed. Do not mount a ServiceAccount token or add Linux capabilities to work around that failure.

The probes use `GET /` because the Web server has no unauthenticated health endpoint. A non-200 response means the frontend or profile has not mounted, so inspect `docker compose logs` or `kubectl logs` before changing probe timings.

## Release assets

A `dsh-v<version>` tag builds one `linux/amd64` image, saves it as `dsh-container-image-<version>-linux-amd64.tar.gz`, reloads that archive, and health-checks the restored image. The matching GitHub Release keeps that image, the `dsh-container-<version>.tar.gz` deployment bundle, and both SHA-256 files. The workflow does not log in to or publish to an image registry. A manual run performs the same build and retains the four files as a 30-day Actions artifact instead of creating a Release. The npm release workflow remains separate; `pnpm run release:pack` does not contain the Docker image. Build from source on another architecture, or publish an architecture-specific image to a registry you control. Pin that registry tag or digest in production and update the Kustomize image override with the application version.

## Troubleshooting

- **The container exits before listening** — check `DSH_ALLOW_NON_LOOPBACK=1` when `DSH_WEB_HOST=0.0.0.0`, and verify that `DSH_WEB_PORT` is an integer from 1 to 65535.
- **The page loads but `/api` returns 403** — add the browser's exact `Host` authority to `DSH_TRUSTED_HOSTS`; forwarded host headers are not used as a substitute.
- **The pod is ready but shell tools fail** — inspect sandbox logs and the worker node's user-namespace policy; the image fails closed when `bubblewrap` or the required kernel feature is unavailable.
- **Data disappears after a restart** — verify that both `dsh-data` and `dsh-workspace` are mounted and that the claims are bound.
