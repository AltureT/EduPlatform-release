import { BrowserRouter, Routes, Route } from 'react-router-dom';
import StudentApp from './shells/StudentApp.jsx';
import TeacherApp from './shells/TeacherApp.jsx';
import './global.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/teacher/*" element={<TeacherApp />} />
        <Route path="/*" element={<StudentApp />} />
      </Routes>
    </BrowserRouter>
  );
}
