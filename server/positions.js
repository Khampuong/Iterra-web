// ตำแหน่งงาน 17 บทบาท 4 กลุ่ม และ 6 ช่วงการทำงาน ตาม Software Team Guide
// rate = ค่าเริ่มต้นต้นทุนต่อ man-day (บาท) แก้ไขได้ในหน้า "ตั้งค่า"

export const GROUPS = [
  { id: 'plan', name: 'วางแผนและธุรกิจ' },
  { id: 'design', name: 'วิเคราะห์และออกแบบ' },
  { id: 'dev', name: 'พัฒนา' },
  { id: 'ops', name: 'ทดสอบและดูแลระบบ' },
];

export const PHASES = [
  { id: 'requirement', name: 'Requirement', th: 'รับโจทย์และวางแผน' },
  { id: 'design', name: 'Design', th: 'วิเคราะห์และออกแบบ' },
  { id: 'development', name: 'Development', th: 'ลงมือพัฒนา' },
  { id: 'testing', name: 'Testing', th: 'ทดสอบและยืนยัน' },
  { id: 'deployment', name: 'Deployment', th: 'นำขึ้นใช้งาน' },
  { id: 'support', name: 'Support', th: 'ดูแลและพัฒนาต่อ' },
];

export const POSITIONS = [
  { code: 'PO', name: 'Product Owner', th: 'เจ้าของผลิตภัณฑ์', group: 'plan', phase: 'requirement', rate: 6000 },
  { code: 'PM', name: 'Project Manager', th: 'ผู้จัดการโครงการ', group: 'plan', phase: 'requirement', rate: 5500 },
  { code: 'BA', name: 'Business Analyst', th: 'นักวิเคราะห์ธุรกิจ', group: 'plan', phase: 'requirement', rate: 4500 },
  { code: 'SA', name: 'System Analyst', th: 'นักวิเคราะห์ระบบ', group: 'design', phase: 'design', rate: 5000 },
  { code: 'ARCH', name: 'Solution Architect', th: 'สถาปนิกโซลูชัน', group: 'design', phase: 'design', rate: 7000 },
  { code: 'UX', name: 'UI/UX Designer', th: 'นักออกแบบประสบการณ์ผู้ใช้', group: 'design', phase: 'design', rate: 4500 },
  { code: 'FE', name: 'Frontend Developer', th: 'นักพัฒนาหน้าจอ', group: 'dev', phase: 'development', rate: 4000 },
  { code: 'BE', name: 'Backend Developer', th: 'นักพัฒนาระบบหลังบ้าน', group: 'dev', phase: 'development', rate: 4500 },
  { code: 'FULL', name: 'Full Stack Developer', th: 'นักพัฒนาแบบครบส่วน', group: 'dev', phase: 'development', rate: 4500 },
  { code: 'MOBILE', name: 'Mobile Developer', th: 'นักพัฒนาแอปมือถือ', group: 'dev', phase: 'development', rate: 4500 },
  { code: 'DBA', name: 'Database Administrator', th: 'ผู้ดูแลฐานข้อมูล', group: 'dev', phase: 'development', rate: 5000 },
  { code: 'LEAD', name: 'Tech Lead', th: 'หัวหน้าด้านเทคนิค', group: 'dev', phase: 'development', rate: 6500 },
  { code: 'QA', name: 'QA / Software Tester', th: 'ผู้ทดสอบระบบ', group: 'ops', phase: 'testing', rate: 3500 },
  { code: 'DEVOPS', name: 'DevOps Engineer', th: 'วิศวกรระบบส่งมอบซอฟต์แวร์', group: 'ops', phase: 'deployment', rate: 5000 },
  { code: 'INFRA', name: 'Infrastructure / Cloud Engineer', th: 'วิศวกรโครงสร้างพื้นฐาน', group: 'ops', phase: 'deployment', rate: 5000 },
  { code: 'SEC', name: 'Security Engineer', th: 'วิศวกรความปลอดภัย', group: 'ops', phase: 'testing', rate: 6000 },
  { code: 'SUPPORT', name: 'Support / Maintenance', th: 'ผู้ดูแลระบบหลังส่งมอบ', group: 'ops', phase: 'support', rate: 3000 },
];

export const POSITION_CODES = POSITIONS.map((p) => p.code);

// ตำแหน่งของสมาชิก = 17 ตำแหน่งงานผลิต + Sale (ไม่ใช้คิด man-day ในใบเสนอราคา)
export const SALE_POSITION = { code: 'SALE', name: 'Sale', th: 'พนักงานขาย', group: 'plan' };
export const MEMBER_POSITIONS = [SALE_POSITION, ...POSITIONS];
export const MEMBER_POSITION_CODES = MEMBER_POSITIONS.map((p) => p.code);
export const positionByCode = Object.fromEntries(POSITIONS.map((p) => [p.code, p]));
