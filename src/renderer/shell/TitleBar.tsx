import { APP_NAME } from '../../shared/app-info.js';
import iconUrl from '../../../packaging/icons/sources/slash-window-16.svg';

export function TitleBar() {
  return (
    <div className="title-bar" data-region="title-bar">
      <img className="title-bar-icon" src={iconUrl} alt="" />
      <h1 className="title-bar-title">{APP_NAME}</h1>
    </div>
  );
}
