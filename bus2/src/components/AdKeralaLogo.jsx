import { LOGO_SRC } from '../lib/brand';

export default function AdKeralaLogo({ className = '', size = 'md', alt = 'AdKerala' }) {
  const classes = ['adkerala-logo', `adkerala-logo--${size}`, className].filter(Boolean).join(' ');
  return <img src={LOGO_SRC} alt={alt} className={classes} />;
}
