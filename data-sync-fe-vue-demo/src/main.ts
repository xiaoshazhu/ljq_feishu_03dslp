import { createApp } from 'vue';
import {
  Button,
  Checkbox,
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

createApp(App)
  .use(Button)
  .use(Checkbox)
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
