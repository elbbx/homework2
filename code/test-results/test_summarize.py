import unittest
from summarize import summarize

class TestSummarize(unittest.TestCase):
    def test_normal_cases(self):
        self.assertEqual(summarize([90, 80, 70]), (80.0, 90, 70))
        self.assertEqual(summarize([100]), (100.0, 100, 100))
        self.assertEqual(summarize([85.5, 92.0, 78]), (85.16666666666667, 92.0, 78))

    def test_empty_list(self):
        with self.assertRaises(ValueError) as e:
            summarize([])
        self.assertIn("空列表", str(e.exception))

    def test_out_of_range(self):
        with self.assertRaises(ValueError) as e:
            summarize([50, -10])
        self.assertIn("成绩超出0-100范围", str(e.exception))
        with self.assertRaises(ValueError) as e:
            summarize([50, 101])
        self.assertIn("成绩超出0-100范围", str(e.exception))
        with self.assertRaises(ValueError) as e:
            summarize([50, 100.1])
        self.assertIn("成绩超出0-100范围", str(e.exception))

    def test_non_numeric(self):
        with self.assertRaises(ValueError) as e:
            summarize([50, "abc"])
        self.assertIn("非数值", str(e.exception))
        with self.assertRaises(ValueError) as e:
            summarize([50, None])
        self.assertIn("非数值", str(e.exception))
        with self.assertRaises(ValueError) as e:
            summarize([50, [1]])
        self.assertIn("非数值", str(e.exception))

    def test_boolean_excluded(self):
        with self.assertRaises(ValueError) as e:
            summarize([50, True])
        self.assertIn("布尔值", str(e.exception))
        with self.assertRaises(ValueError) as e:
            summarize([False, 90])
        self.assertIn("布尔值", str(e.exception))

    def test_nan_inf(self):
        with self.assertRaises(ValueError) as e:
            summarize([50, float('nan')])
        self.assertIn("非法浮点数", str(e.exception))
        with self.assertRaises(ValueError) as e:
            summarize([50, float('inf')])
        self.assertIn("非法浮点数", str(e.exception))

if __name__ == '__main__':
    unittest.main()
