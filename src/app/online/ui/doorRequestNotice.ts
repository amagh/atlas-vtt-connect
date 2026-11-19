import type { DoorAsk } from '../tools/DoorRequests';
import { showConfirmNotice } from './confirmNotice';

/** "Anna wants to open a door (locked).", with Allow and Deny, until answered or hidden. Names are text, never HTML. */
export function showDoorRequestNotice(question: DoorAsk, answer: (allow: boolean) => void): { hide(): void } {
  return showConfirmNotice({
    text: (line) => {
      line.appendText(`${question.player} wants to ${question.opening ? 'open' : 'close'} a door.`);
    },
    warning: question.locked ? 'The door is locked: Allow unlocks it.' : null,
    answers: [
      { label: 'Allow', cta: true, run: () => answer(true) },
      { label: 'Deny', run: () => answer(false) },
    ],
  });
}
