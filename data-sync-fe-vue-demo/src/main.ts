import { createApp } from 'vue';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import {
  Button,
  Checkbox,
  ConfigProvider,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Radio,
  Select,
  Space,
  Spin,
  TreeSelect
} from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import App from './App.vue';
import './App.css';

dayjs.locale('zh-cn');

createApp(App)
  .use(Button)
  .use(Checkbox)
  .use(ConfigProvider)
  .use(DatePicker)
  .use(Empty)
  .use(Form)
  .use(Input)
  .use(InputNumber)
  .use(Modal)
  .use(Pagination)
  .use(Radio)
  .use(Select)
  .use(Space)
  .use(Spin)
  .use(TreeSelect)
  .mount('#root');
