# Octopus Mesh — relay experiment

An independent, opt-in experiment alongside ShatterOS. Each browser is a node with a local specialty; a small Node server relays bounded messages. Open it on phones or computers on a trusted LAN. It does not change the ShatterOS world or GhostNode.

## Run

Requires Node.js 22+. No npm installation is needed.

```sh
cd octopus-mesh
node server.mjs
```

Open `http://localhost:8787` on the computer. On the same Wi-Fi, open `http://COMPUTER_LAN_IP:8787` on a phone (allow TCP port 8787 through the computer firewall). Join the same room with different device names and specialties. Send a task; each other browser performs a local, deterministic text transformation and sends a result. Trigger a reflex locally or send a pulse. Simulate a disconnect, trigger a reflex, and reconnect to replay outgoing traces. Open two browser windows for a single-computer trial. Stop with Ctrl-C.

Run transport integration tests with `node --test test/*.test.mjs`.

## What is real

- A server relays actual messages among up to 16 browser nodes per room, including Android browsers. Each node computes its own text transform and can perform its local reflex while disconnected.
- Shared memory consists of small text traces broadcast through the relay and stored in browser localStorage. A disconnected sender keeps an outgoing queue locally and retries on reconnect. Event history is bounded and ephemeral. It is not a CRDT or guaranteed durable delivery. Reloading can invalidate directed tasks and responses, and messages sent while a recipient is absent are not replayed to its new identity.
- Topology and message animations correspond to live polling and received events. The displayed task time is measured on the requester and includes polling and processing; event bytes count serialized relay events, not full HTTP traffic. Browser CPU/battery power is not measured.
- This is deterministic text processing, not an LLM, autonomous learning, or native GhostNode inference. The three specialties illustrate local execution; tasks fan out rather than adaptively route. No Android APK is supplied.

## Security and scope

**Trusted LAN and non-sensitive demo text only.** HTTP is unencrypted; anyone with network access and a room code can join. The server issues temporary bearer credentials to separate node operations, but does not authenticate users or encrypt data. Codes are not a security boundary. Do not expose this relay to the public internet. In-memory rooms disappear on restart. The relay is a single point of failure; nodes can execute local reflexes offline, but cannot communicate until it returns. There is no real direct peer transport, peer discovery, pairing, end-to-end encryption, consent policy, remote device control or access to GhostNode. Local storage is shared with other pages on the same origin.

## Biological inspiration and engineering choices

Octopus arm nerve cords contain repeated ganglia that process sensory input and motor commands while exchanging information with the brain. Evidence suggests centrally coordinated commands interact with local sensory signals, rather than eight independent brains working without central input. Here, local text transforms and immediate local reflexes test the design idea of local action under a shared intent. The mapping is an analogy, not a biological model or a novel neurobiological claim.

- https://pubmed.ncbi.nlm.nih.gov/39326412/ — arm neural structures
- https://pmc.ncbi.nlm.nih.gov/articles/PMC6478645/ — central and local motor command interaction
- https://pubmed.ncbi.nlm.nih.gov/32916119/ — peripheral sensory information used centrally

## Benchmark status

The live round trip is an exploratory measurement of this relay-based prototype only. Centralized, decentralized and hybrid comparisons have **not** been benchmarked; neither power nor real-device reliability has been measured. A valid comparison needs identical workloads, device/browser versions, network conditions, repetitions and failure schedules; collect end-to-end p50/p95, completion rate, actual network bytes and externally measured device energy. Do not compare this demo's relay latency to hypothetical peer-to-peer values.

## Next integration steps

1. Design explicit peer approval, device identities, encrypted authenticated transport, revocation and replay protection before exposing GhostNode capabilities. GhostNode's existing protocol proposal requires these controls and visible tool approval.
2. Add a real peer data path with relay-assisted discovery and test partitions and reconnection across physical devices. Specify conflict resolution and idempotent delivery before claiming shared durable memory.
3. Replace fan-out with measurable capability/availability/energy-aware routing. Compare this with centralized and peer-only implementations using the same workload; measure power on hardware.
