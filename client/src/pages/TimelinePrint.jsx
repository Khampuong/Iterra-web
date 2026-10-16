import { useParams } from 'react-router-dom';
import { Icon, useData } from '../components/ui.jsx';
import ProjectTimeline from '../components/ProjectCalendar.jsx';

// หน้าปฏิทินแผนงานแบบเต็มหน้า สำหรับพิมพ์หรือบันทึกเป็น PDF ส่งให้ลูกค้า (ไม่แสดงตัวเลขเงิน)
export default function TimelinePrint() {
  const { id } = useParams();
  const [p] = useData(`/projects/${id}`);
  if (!p) return null;
  return (
    <div className="tl-page">
      <div className="tl-actions">
        <button className="btn primary" onClick={() => window.print()}><Icon name="print" />พิมพ์ / บันทึกเป็น PDF</button>
      </div>
      <main><ProjectTimeline p={p} /></main>
    </div>
  );
}
