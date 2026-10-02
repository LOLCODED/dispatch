import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
const components = { a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer"/> };

export function Markdown({ children, className = '' }) {
  return <div className={`markdown ${className}`}><ReactMarkdown remarkPlugins={plugins} components={components}>{children}</ReactMarkdown></div>;
}
