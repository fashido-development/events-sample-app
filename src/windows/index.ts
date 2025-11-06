import 'reflect-metadata';
import { container, inject, injectable } from 'tsyringe';
import gameData from '../overwolf-platform/config/game-data';
import {
  GameClosedPayload,
  GameDetectionServiceBase,
  GameDetectionToken,
  GameLaunchedPayload,
  PostGamePayload,
} from '../types/services/game-detection-service-base';
import { LoggingService } from '../overwolf-platform/services/logging-service';
import { GEPService } from '../overwolf-platform/services/gep-service';
import { CommunicationHostService } from '../overwolf-platform/services/communication-host-service';
import { GameDetectionService } from '../overwolf-platform/services/game-detection-service';
import { WindowManagerService } from '../overwolf-platform/services/window-manager.service';
import { IN_GAME_WINDOW } from '../constants/window-names';
import {
  CommunicationBustHostPayload,
  CommunicationHostServiceBase,
  CommunicationHostToken,
} from '../types/services/communication-host-service-base';
import {
  WindowManagerServiceBase,
  WindowManagerToken,
} from '../types/services/window-manager-service-base';
import { GEPServiceBase, GEPToken } from '../types/services/gep-service-base';
import {
  LoggingToken,
  LoggingServiceBase,
} from '../types/services/logging-service-base';
import { SettingsToken } from '../types/services/settings-service-base';
import { SettingsService } from '../overwolf-platform/services/settings-service';

container.registerSingleton(GEPToken, GEPService);
container.registerSingleton(SettingsToken, SettingsService);
container.registerSingleton(LoggingToken, LoggingService);
container.registerSingleton(GameDetectionToken, GameDetectionService);
container.registerSingleton(WindowManagerToken, WindowManagerService);
container.registerSingleton(CommunicationHostToken, CommunicationHostService);

// -----------------------------------------------------------------------------
@injectable()
export class IndexController {
  private readonly inGameName = 'in-game';

  // NEW: cache last "launched" text to send when the in-game connects
  private lastLaunchedText: string | null = null;

  public constructor(
    @inject(GEPToken)
    private readonly gepService: GEPServiceBase,
    @inject(LoggingToken)
    private readonly loggingService: LoggingServiceBase,
    @inject(GameDetectionToken)
    private readonly gameDetectionService: GameDetectionServiceBase,
    @inject(WindowManagerToken)
    private readonly windowManagerService: WindowManagerServiceBase,
    @inject(CommunicationHostToken)
    private readonly communicationBusHostService: CommunicationHostServiceBase,
  ) {
    this.communicationBusHostService.initializeCommunicationBusHost();
    this.loggingService.init(IN_GAME_WINDOW);
    this.init();
  }

  public init(): void {
    this.gameDetectionService.on('gameLaunched', (payload) => this.onGameStart(payload));
    this.gameDetectionService.on('gameClosed', (payload) => this.onGameClosed(payload));
    this.gameDetectionService.on('postGame', this.onPostGame);

    this.communicationBusHostService.addListener('windowConnected', this.connectInGame);

    this.gameDetectionService.start();
  }

  private connectInGame = (event: CommunicationBustHostPayload) => {
    const inGameConnector = event.connector;
    inGameConnector.connectionReceived(container);

    // If we already know about a launched game, send that info to the in-game window now
    if (this.lastLaunchedText) {
      // NOTE: if your API is called postMessage/sendMessageToWindow/broadcastMessage, swap here:
      this.communicationBusHostService.sendMessage(this.inGameName, {
        type: 'game-launched',
        text: this.lastLaunchedText,
      });
    }
  };

  private onGameStart(gameLaunch: GameLaunchedPayload) {
    const text = `Game was launched: ${gameLaunch.name} ${gameLaunch.id}`;
    console.log(text);

    // cache it for when/if the in-game window connects (or reconnects)
    this.lastLaunchedText = text;

    this.loggingService.reCheckGEPVersion();

    const gameConfig = gameData[gameLaunch.id];
    if (gameConfig) {
      this.windowManagerService.openWindow(this.inGameName);

      // Try to send immediately too (in case the in-game is already connected).
      // Safe even if nobody is listening; we still keep the cache for connect-time replay.
      this.communicationBusHostService.sendMessage(this.inGameName, {
        type: 'game-launched',
        text,
      });

      this.gepService.onGameLaunched(gameConfig.interestedInFeatures);
    }
  }

  private onGameClosed(gameClosed: GameClosedPayload) {
    console.log(`Game was closed: ${gameClosed.name}`);
    const gameConfig = gameData[gameClosed.id];
    if (gameConfig) {
      this.windowManagerService.closeWindow(this.inGameName, (window) => {
        this.communicationBusHostService.windowDisconnected(window.windowName);
        this.loggingService.backupLog(
          `${gameClosed.name.replaceAll(/[^a-z0-9]/gi, '')}/${new Date()
            .toISOString()
            .replaceAll(/[:]/gm, '-')
            .replace('T', '--')
            .replace(/\.\d+Z/gm, '')}`,
        );
      });
      this.gepService.onGameClosed();

      // Optional: clear the cached text after the game closes
      this.lastLaunchedText = null;
    }
  }

  private onPostGame(postGame: PostGamePayload) {
    console.log(`Running post-game logic for game: ${postGame.name}`);
  }
}

container.resolve(IndexController);
