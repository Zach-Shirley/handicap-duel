# Handicap Duel

A two-player arena game built so a younger sibling can actually beat an older one. One player is on a computer and the other on a phone, and every round the computer player wins handicaps them a bit more. Each round the phone player wins takes some of that handicap back. Over a few matches the game settles where the weaker player wins about half the time.

Three games, picked in the lobby:

| Game | Goal | Handicap |
|---|---|---|
| **Coin Rush** | Grab the most coins in 30 seconds. Big orange coins are worth 3. | Speed ×0.92 per win |
| **Paint the Floor** | Your dot paints the floor tiles it touches. Own more floor after 30 seconds. You can paint over the other player's tiles. | Speed ×0.92 per win |
| **Meteor Dodge** | Meteors land where the warning circles are. One hit and you're out. If you both survive 30 seconds, a meteor storm starts. | +16% size per win |

## How to play

1. On the computer, open the site, enter a name and click **Host a game**.
2. On the phone, scan the QR code, or open the site and type the 5-character room code.
3. Pick a game, then click **Start match** on the computer. First to 5 round wins takes the match.

- Computer: WASD or arrow keys.
- Phone: put a thumb anywhere and drag. The stick follows your thumb.
- Bumping into the other player knocks you both back.
- A tied round goes to sudden death: the next coin or tile wins.
- In Meteor Dodge, about half the meteors aim at where a player is standing, alternating between the two players. If both players are hit in the same instant, nobody is out.
- The handicap has no limit. Speed keeps shrinking by 8% of its current value (it never reaches zero), and size keeps growing until the dot fills the arena from top to bottom.
- A computer win first takes back any handicap on the phone player, then handicaps the computer player. A phone win takes back one step of the computer player's handicap and never handicaps the phone player.
- The lobby table lets the host set speed (5% steps, 5–250%) and size (10% steps, 30% and up) for both players. Both stats apply in every game; being bigger helps in Coin Rush and Paint. The values are saved in the computer's browser and carry over between matches and games.
- **Practice on one keyboard** runs both players locally (WASD versus arrows) with no network.

## How it works

- **Simulation** (`src/game.ts`): fixed-step, pure TypeScript with an injectable random source. The host's browser is the only authority. All three games share movement, bumps and the round, match and sudden-death flow.
- **Handicap** (`src/handicap.ts`): speed and size multipliers for each player. Coin Rush and Paint step speed automatically; Meteor Dodge steps size. Manual boosts (faster or smaller than normal) are never touched by the automatic steps.
- **Networking** (`src/net.ts`): the browsers connect peer-to-peer over WebRTC using [PeerJS](https://peerjs.com/). PeerJS's free public broker is used only to match the room code; game traffic then goes directly between the devices, or through PeerJS's public TURN relay if a direct path fails. The phone sends stick input about 30 times a second. The computer sends back snapshots about 30 times a second, and the phone renders them about 50 ms behind, interpolating player positions.
- **Rendering** (`src/render.ts`): Canvas 2D with particles and screen shake. Sound effects are procedural Web Audio; there are no audio files.

## Development

```bash
npm install
npm run dev        # http://127.0.0.1:5370
npm test           # vitest: round flow, sudden death, handicap rules, movement, bumps, paint, meteors
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
