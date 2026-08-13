interface FooterProps {
  installed: boolean;
  saved: boolean;
  tuningEnabled: boolean;
  loudnessEnabled: boolean;
  preampDb: number;
  format: string;
}

export default function Footer({
  installed,
  saved,
  tuningEnabled,
  loudnessEnabled,
  preampDb,
  format,
}: FooterProps) {
  return (
    <footer className="status-bar">
      <span className="status-item">
        <span className={`dot ${installed ? "green" : "gray"}`} />
        {installed ? "VxAPO 已安装" : "VxAPO 未安装"}
      </span>
      <span className="sep" />
      <span className="status-item">
        <span className={`dot ${tuningEnabled ? "green" : "gray"}`} />
        {tuningEnabled ? "调音已启用" : "调音未启用"}
      </span>
      <span className="sep" />
      <span className="status-item">
        {saved ? "配置已保存" : <b>配置未保存</b>}
      </span>

      <span className="status-right">
        <span className="status-item">
          响度补偿已{loudnessEnabled ? `开启：${preampDb.toFixed(1)} dB` : "关闭"}
        </span>
        <span className="sep" />
        <span className="status-item mono">{format}</span>
      </span>
    </footer>
  );
}
