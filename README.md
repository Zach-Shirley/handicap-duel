# Handicap Duel

A two-player coin grab built so a younger sibling can actually beat an older one. One player is on a computer and the other on a phone. Rounds are 30 seconds long, and whoever grabs more coins wins the round. Each time the computer player wins a round, they get 8% slower. Each time the phone player wins, the computer player gets that speed back. Over a few matches the game settles where the weaker player wins about half the time.

## How to play

1. On the computer, open the site, enter a name and click **Host a game**.
2. On the phone, scan the QR code, or open the site and type the 5-character room code.
3. Click **Start match** on the computer. First to 5 round wins takes the match.

- Computer: WASD or arrow keys.
- Phone: put a thumb anywhere and drag. The stick follows your thumb.
- Bumping into the other player knocks you both back.
- Big orange coins are worth 3.
- A tied round goes to sudden death, where the next coin wins.
- The lobby has manual "starting speed" buttons. The current handicap is saved in the computer's browser and carries over between matches.
- **Practice on one keyboard** runs both players locally (WASD versus arrows) with no network.

## How it works

- **Simulation** (`src/game.ts`): fixed-step, pure TypeScript with an injectable random source. The host's browser is the only authority.
- **Handicap** (`src/handicap.ts`): one signed number. Positive slows the host and negative slows the guest. A negative value only comes from the manual lobby setting.
- **Networking** (`src/net.ts`): the browsers connect peer-to-peer over WebRTC using [PeerJS](https://peerjs.com/). PeerJS's free public broker is used only to match the room code; game traffic then goes directly between the devices, or through PeerJS's public TURN relay if a direct path fails. The phone sends stick input about 30 times a second. The computer sends back snapshots about 30 times a second, and the phone renders them about 50 ms behind, interpolating player positions.
- **Rendering** (`src/render.ts`): Canvas 2D with particles and screen shake. Sound effects are procedural Web Audio; there are no audio files.

## Development

```bash
npm install
npm run dev        # http://127.0.0.1:5370
npm test           # vitest: round flow, sudden death, handicap rules, movement, bumps
npm run build
```

`npm run dev:lan` serves on the local network for phone testing. Dev builds expose a `window.__hd` hook for driving frames when the tab is hidden.

## Limits

- Matchmaking depends on the PeerJS public broker. If it's down, rooms can't open.
- The host has slightly less input delay than the phone. The handicap absorbs this, but it isn't zero.
- No accounts, no server-side state and no internet lobby. You join only by code or link.
- If the host tab is in the background, the game pauses because browsers throttle hidden tabs.
- iOS Safari doesn't allow page fullscreen. Turning the phone sideways gives the best view.

## Credits

Directed by Zach Shirley. Designed and coded with heavy AI assistance (Claude), including the game rules, networking and tests. Verified with unit tests and two-browser-tab play; real phone-versus-computer play is still to come.
