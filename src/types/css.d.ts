declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module '*.wasm' {
  const asset: number;
  export default asset;
}

declare module '@/global.css';
