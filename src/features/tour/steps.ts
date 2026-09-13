/**
 * The first-run tour. Each step points at a real element via `data-tour="<anchor>"`; a step
 * whose anchor is not on screen is skipped rather than rendered against nothing, so the tour
 * survives a narrow window, an empty board, or a view that hides part of the chrome.
 *
 * Keep these in the order someone would actually meet them: where things are, then how to
 * put something in, then what happens next.
 */
export interface TourStep {
  /** Matches a data-tour attribute. Omit for a step that stands alone in the middle. */
  anchor?: string;
  title: string;
  body: string;
  /** Route to be on for this step. The tour navigates there before showing it. */
  path?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to the bugtracker',
    body: 'Two minutes and you will know where everything lives. You can stop any time, and replay this from the menu with your name on it.',
    path: '/home',
  },
  {
    anchor: 'nav-home',
    title: 'Home is your list',
    body: 'What is assigned to you, what you are watching, what you starred, and anything waiting to be triaged. Start here every morning.',
    path: '/home',
  },
  {
    anchor: 'nav-intake',
    title: 'Intake is the triage queue',
    body: 'Anything that arrived without a team, a priority or a work type lands here — including bugs captured from Slack. Give it those three things and it moves onto the board.',
  },
  {
    anchor: 'nav-board',
    title: 'The board is the state of play',
    body: 'Columns are Status: Backlog through Done. Drag a card to move it. List and Spreadsheet are the same issues in denser shapes.',
    path: '/board',
  },
  {
    anchor: 'new-issue',
    title: 'File a bug',
    body: 'Or just press C from anywhere. Title, a description, and whatever you already know — the rest can be filled in during triage.',
  },
  {
    anchor: 'filters',
    title: 'Filter, then save the filter',
    body: 'Narrow by team, priority, assignee or free text. Press / to search. Every filter is in the URL, so a link is a shareable view.',
  },
  {
    anchor: 'views',
    title: 'Saved views',
    body: 'Save the filters you keep re-typing. Pin one and it shows up on Home. Views follow your account, not this browser.',
  },
  {
    title: 'Watch what you care about',
    body: 'Open any issue and hit Watch. You get a Slack DM when it moves, gets a comment, or a pull request touches it — batched, so a busy issue is one message, not ten. You are watching automatically anything you report, are assigned, comment on, or get @mentioned in.',
  },
  {
    anchor: 'nav-analytics',
    title: 'Analytics and dashboards',
    body: 'Throughput, ageing, time-to-close. Build your own dashboard from the same measures and it is saved to your account.',
    path: '/analytics',
  },
  {
    title: 'That is the whole tool',
    body: 'Paste RAD-42 in a pull request branch or title and it links itself and moves the issue along. Everything else you can learn by clicking.',
  },
];
