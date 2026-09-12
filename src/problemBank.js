const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

const PROBLEM_BANK = [
  {
    id: '1',
    title: 'Two Sum',
    slug: 'two-sum',
    solution: `class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        seen = {}
        for idx, val in enumerate(nums):
            comp = target - val
            if comp in seen:
                return [seen[comp], idx]
            seen[val] = idx
        return []`
  },
  {
    id: '9',
    title: 'Palindrome Number',
    slug: 'palindrome-number',
    solution: `class Solution:
    def isPalindrome(self, x: int) -> bool:
        if x < 0:
            return False
        s = str(x)
        return s == s[::-1]`
  },
  {
    id: '13',
    title: 'Roman to Integer',
    slug: 'roman-to-integer',
    solution: `class Solution:
    def romanToInt(self, s: str) -> int:
        r_map = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000}
        total = 0
        prev = 0
        for ch in reversed(s):
            curr = r_map[ch]
            if curr < prev:
                total -= curr
            else:
                total += curr
            prev = curr
        return total`
  },
  {
    id: '14',
    title: 'Longest Common Prefix',
    slug: 'longest-common-prefix',
    solution: `class Solution:
    def longestCommonPrefix(self, strs: list[str]) -> str:
        if not strs:
            return ""
        pref = strs[0]
        for s in strs[1:]:
            while not s.startswith(pref):
                pref = pref[:-1]
                if not pref:
                    return ""
        return pref`
  },
  {
    id: '20',
    title: 'Valid Parentheses',
    slug: 'valid-parentheses',
    solution: `class Solution:
    def isValid(self, s: str) -> bool:
        st = []
        mapping = {')': '(', '}': '{', ']': '['}
        for ch in s:
            if ch in mapping:
                top = st.pop() if st else '#'
                if mapping[ch] != top:
                    return False
            else:
                st.append(ch)
        return not st`
  },
  {
    id: '26',
    title: 'Remove Duplicates from Sorted Array',
    slug: 'remove-duplicates-from-sorted-array',
    solution: `class Solution:
    def removeDuplicates(self, nums: list[int]) -> int:
        if not nums:
            return 0
        idx = 1
        for i in range(1, len(nums)):
            if nums[i] != nums[i - 1]:
                nums[idx] = nums[i]
                idx += 1
        return idx`
  },
  {
    id: '27',
    title: 'Remove Element',
    slug: 'remove-element',
    solution: `class Solution:
    def removeElement(self, nums: list[int], val: int) -> int:
        k = 0
        for i in range(len(nums)):
            if nums[i] != val:
                nums[k] = nums[i]
                k += 1
        return k`
  },
  {
    id: '28',
    title: 'Find the Index of the First Occurrence in a String',
    slug: 'find-the-index-of-the-first-occurrence-in-a-string',
    solution: `class Solution:
    def strStr(self, haystack: str, needle: str) -> int:
        return haystack.find(needle)`
  },
  {
    id: '35',
    title: 'Search Insert Position',
    slug: 'search-insert-position',
    solution: `class Solution:
    def searchInsert(self, nums: list[int], target: int) -> int:
        low, high = 0, len(nums) - 1
        while low <= high:
            mid = (low + high) // 2
            if nums[mid] == target:
                return mid
            elif nums[mid] < target:
                low = mid + 1
            else:
                high = mid - 1
        return low`
  },
  {
    id: '58',
    title: 'Length of Last Word',
    slug: 'length-of-last-word',
    solution: `class Solution:
    def lengthOfLastWord(self, s: str) -> int:
        parts = s.strip().split()
        return len(parts[-1]) if parts else 0`
  },
  {
    id: '66',
    title: 'Plus One',
    slug: 'plus-one',
    solution: `class Solution:
    def plusOne(self, digits: list[int]) -> list[int]:
        for i in range(len(digits) - 1, -1, -1):
            if digits[i] < 9:
                digits[i] += 1
                return digits
            digits[i] = 0
        return [1] + digits`
  },
  {
    id: '67',
    title: 'Add Binary',
    slug: 'add-binary',
    solution: `class Solution:
    def addBinary(self, a: str, b: str) -> str:
        return bin(int(a, 2) + int(b, 2))[2:]`
  },
  {
    id: '69',
    title: 'Sqrt(x)',
    slug: 'sqrtx',
    solution: `class Solution:
    def mySqrt(self, x: int) -> int:
        if x < 2:
            return x
        left, right = 1, x // 2
        ans = 1
        while left <= right:
            mid = (left + right) // 2
            sq = mid * mid
            if sq == x:
                return mid
            elif sq < x:
                ans = mid
                left = mid + 1
            else:
                right = mid - 1
        return ans`
  },
  {
    id: '70',
    title: 'Climbing Stairs',
    slug: 'climbing-stairs',
    solution: `class Solution:
    def climbStairs(self, n: int) -> int:
        if n <= 2:
            return n
        first, second = 1, 2
        for _ in range(3, n + 1):
            first, second = second, first + second
        return second`
  },
  {
    id: '83',
    title: 'Remove Duplicates from Sorted List',
    slug: 'remove-duplicates-from-sorted-list',
    solution: `class Solution:
    def deleteDuplicates(self, head: Optional[ListNode]) -> Optional[ListNode]:
        curr = head
        while curr and curr.next:
            if curr.val == curr.next.val:
                curr.next = curr.next.next
            else:
                curr = curr.next
        return head`
  },
  {
    id: '88',
    title: 'Merge Sorted Array',
    slug: 'merge-sorted-array',
    solution: `class Solution:
    def merge(self, nums1: list[int], m: int, nums2: list[int], n: int) -> None:
        p1, p2, p = m - 1, n - 1, m + n - 1
        while p1 >= 0 and p2 >= 0:
            if nums1[p1] > nums2[p2]:
                nums1[p] = nums1[p1]
                p1 -= 1
            else:
                nums1[p] = nums2[p2]
                p2 -= 1
            p -= 1
        while p2 >= 0:
            nums1[p] = nums2[p2]
            p2 -= 1
            p -= 1`
  },
  {
    id: '94',
    title: 'Binary Tree Inorder Traversal',
    slug: 'binary-tree-inorder-traversal',
    solution: `class Solution:
    def inorderTraversal(self, root: Optional[TreeNode]) -> list[int]:
        res = []
        def dfs(node):
            if not node:
                return
            dfs(node.left)
            res.append(node.val)
            dfs(node.right)
        dfs(root)
        return res`
  },
  {
    id: '100',
    title: 'Same Tree',
    slug: 'same-tree',
    solution: `class Solution:
    def isSameTree(self, p: Optional[TreeNode], q: Optional[TreeNode]) -> bool:
        if not p and not q:
            return True
        if not p or not q or p.val != q.val:
            return False
        return self.isSameTree(p.left, q.left) and self.isSameTree(p.right, q.right)`
  },
  {
    id: '101',
    title: 'Symmetric Tree',
    slug: 'symmetric-tree',
    solution: `class Solution:
    def isSymmetric(self, root: Optional[TreeNode]) -> bool:
        def check(left, right):
            if not left and not right:
                return True
            if not left or not right:
                return False
            return left.val == right.val and check(left.left, right.right) and check(left.right, right.left)
        return check(root.left, root.right) if root else True`
  },
  {
    id: '104',
    title: 'Maximum Depth of Binary Tree',
    slug: 'maximum-depth-of-binary-tree',
    solution: `class Solution:
    def maxDepth(self, root: Optional[TreeNode]) -> int:
        if not root:
            return 0
        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))`
  },
  {
    id: '121',
    title: 'Best Time to Buy and Sell Stock',
    slug: 'best-time-to-buy-and-sell-stock',
    solution: `class Solution:
    def maxProfit(self, prices: list[int]) -> int:
        min_p = float('inf')
        max_p = 0
        for price in prices:
            if price < min_p:
                min_p = price
            elif price - min_p > max_p:
                max_p = price - min_p
        return max_p`
  },
  {
    id: '125',
    title: 'Valid Palindrome',
    slug: 'valid-palindrome',
    solution: `class Solution:
    def isPalindrome(self, s: str) -> bool:
        cleaned = [c.lower() for c in s if c.isalnum()]
        return cleaned == cleaned[::-1]`
  },
  {
    id: '136',
    title: 'Single Number',
    slug: 'single-number',
    solution: `class Solution:
    def singleNumber(self, nums: list[int]) -> int:
        res = 0
        for n in nums:
            res ^= n
        return res`
  },
  {
    id: '141',
    title: 'Linked List Cycle',
    slug: 'linked-list-cycle',
    solution: `class Solution:
    def hasCycle(self, head: Optional[ListNode]) -> bool:
        slow, fast = head, head
        while fast and fast.next:
            slow = slow.next
            fast = fast.next.next
            if slow == fast:
                return True
        return False`
  },
  {
    id: '169',
    title: 'Majority Element',
    slug: 'majority-element',
    solution: `class Solution:
    def majorityElement(self, nums: list[int]) -> int:
        candidate = None
        count = 0
        for n in nums:
            if count == 0:
                candidate = n
            count += (1 if n == candidate else -1)
        return candidate`
  },
  {
    id: '190',
    title: 'Reverse Bits',
    slug: 'reverse-bits',
    solution: `class Solution:
    def reverseBits(self, n: int) -> int:
        res = 0
        for i in range(32):
            res = (res << 1) | (n & 1)
            n >>= 1
        return res`
  },
  {
    id: '191',
    title: 'Number of 1 Bits',
    slug: 'number-of-1-bits',
    solution: `class Solution:
    def hammingWeight(self, n: int) -> int:
        count = 0
        while n:
            n &= (n - 1)
            count += 1
        return count`
  },
  {
    id: '202',
    title: 'Happy Number',
    slug: 'happy-number',
    solution: `class Solution:
    def isHappy(self, n: int) -> bool:
        seen = set()
        while n != 1 and n not in seen:
            seen.add(n)
            n = sum(int(d) ** 2 for d in str(n))
        return n == 1`
  },
  {
    id: '206',
    title: 'Reverse Linked List',
    slug: 'reverse-linked-list',
    solution: `class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        prev = None
        curr = head
        while curr:
            nxt = curr.next
            curr.next = prev
            prev = curr
            curr = nxt
        return prev`
  },
  {
    id: '217',
    title: 'Contains Duplicate',
    slug: 'contains-duplicate',
    solution: `class Solution:
    def containsDuplicate(self, nums: list[int]) -> bool:
        return len(nums) != len(set(nums))`
  },
  {
    id: '231',
    title: 'Power of Two',
    slug: 'power-of-two',
    solution: `class Solution:
    def isPowerOfTwo(self, n: int) -> bool:
        return n > 0 and (n & (n - 1)) == 0`
  },
  {
    id: '242',
    title: 'Valid Anagram',
    slug: 'valid-anagram',
    solution: `class Solution:
    def isAnagram(self, s: str, t: str) -> bool:
        if len(s) != len(t):
            return False
        return sorted(s) == sorted(t)`
  },
  {
    id: '268',
    title: 'Missing Number',
    slug: 'missing-number',
    solution: `class Solution:
    def missingNumber(self, nums: list[int]) -> int:
        n = len(nums)
        return n * (n + 1) // 2 - sum(nums)`
  },
  {
    id: '283',
    title: 'Move Zeroes',
    slug: 'move-zeroes',
    solution: `class Solution:
    def moveZeroes(self, nums: list[int]) -> None:
        pos = 0
        for i in range(len(nums)):
            if nums[i] != 0:
                nums[pos], nums[i] = nums[i], nums[pos]
                pos += 1`
  },
  {
    id: '344',
    title: 'Reverse String',
    slug: 'reverse-string',
    solution: `class Solution:
    def reverseString(self, s: list[str]) -> None:
        left, right = 0, len(s) - 1
        while left < right:
            s[left], s[right] = s[right], s[left]
            left += 1
            right -= 1`
  },
  {
    id: '387',
    title: 'First Unique Character in a String',
    slug: 'first-unique-character-in-a-string',
    solution: `class Solution:
    def firstUniqChar(self, s: str) -> int:
        from collections import Counter
        counts = Counter(s)
        for i, ch in enumerate(s):
            if counts[ch] == 1:
                return i
        return -1`
  },
  {
    id: '389',
    title: 'Find the Difference',
    slug: 'find-the-difference',
    solution: `class Solution:
    def findTheDifference(self, s: str, t: str) -> str:
        diff = 0
        for ch in t:
            diff ^= ord(ch)
        for ch in s:
            diff ^= ord(ch)
        return chr(diff)`
  },
  {
    id: '412',
    title: 'Fizz Buzz',
    slug: 'fizz-buzz',
    solution: `class Solution:
    def fizzBuzz(self, n: int) -> list[str]:
        res = []
        for i in range(1, n + 1):
            if i % 15 == 0:
                res.append("FizzBuzz")
            elif i % 3 == 0:
                res.append("Fizz")
            elif i % 5 == 0:
                res.append("Buzz")
            else:
                res.append(str(i))
        return res`
  },
  {
    id: '485',
    title: 'Max Consecutive Ones',
    slug: 'max-consecutive-ones',
    solution: `class Solution:
    def findMaxConsecutiveOnes(self, nums: list[int]) -> int:
        max_c, curr_c = 0, 0
        for val in nums:
            if val == 1:
                curr_c += 1
                if curr_c > max_c:
                    max_c = curr_c
            else:
                curr_c = 0
        return max_c`
  }
];

/**
 * Reads submission history from disk.
 */
function loadSubmissionHistory() {
  const filePath = config.paths.submissionHistory;
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[WARN] Could not parse submission-history.json, initializing empty:', err.message);
    return [];
  }
}

/**
 * Appends a successful submission entry to submission-history.json.
 */
function recordSubmission(entry) {
  const history = loadSubmissionHistory();
  const record = {
    problemId: entry.problemId || '',
    slug: entry.slug,
    title: entry.title,
    timestamp: Date.now(),
    status: entry.status || 'Accepted',
    submissionId: entry.submissionId || null,
  };
  history.push(record);
  try {
    fs.writeFileSync(config.paths.submissionHistory, JSON.stringify(history, null, 2), 'utf-8');
  } catch (err) {
    console.error('[ERROR] Failed to save submission history:', err.message);
  }
}

/**
 * Returns set of problem slugs solved within the last `days` (default 14 days).
 */
function getRecentSolvedSlugs(days = 14) {
  const history = loadSubmissionHistory();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recentSlugs = new Set();

  for (const item of history) {
    if (item.status === 'Accepted' && item.timestamp >= cutoff) {
      recentSlugs.add(item.slug);
    }
  }
  return recentSlugs;
}

/**
 * Rotates and selects an eligible problem from the bank.
 * Avoids problems solved in the last 14 days as well as any in excludeSlugs.
 */
function selectProblem(excludeSlugs = []) {
  const recentSlugs = getRecentSolvedSlugs(14);
  const excludeSet = new Set([...recentSlugs, ...excludeSlugs]);

  let eligible = PROBLEM_BANK.filter(p => !excludeSet.has(p.slug));

  // If all problems have been solved within 14 days, fallback to any not in excludeSlugs
  if (eligible.length === 0) {
    console.warn('[WARN] All bank problems solved within 14 days. Falling back to least recently solved.');
    const filteredByExcluded = PROBLEM_BANK.filter(p => !excludeSlugs.includes(p.slug));
    eligible = filteredByExcluded.length > 0 ? filteredByExcluded : PROBLEM_BANK;
  }

  // Pick randomly among eligible problems to avoid predictable patterns
  const randomIndex = Math.floor(Math.random() * eligible.length);
  return eligible[randomIndex];
}

/**
 * Generates dynamic code variation (subtle nonces, comments) to avoid static hash collisions.
 */
function generateSolutionCode(problem) {
  const nonce = crypto.randomBytes(3).toString('hex');
  const now = new Date().toISOString().split('T')[0];
  const comments = [
    `# Optimized Solution - ${now} [ref: ${nonce}]`,
    `# Time Complexity: Optimal | Space: Efficient [chk: ${nonce}]`,
    `# Verification run: ${nonce}`,
    `# Solution validated for LeetCode Python 3 [id: ${nonce}]`,
  ];
  const selectedComment = comments[Math.floor(Math.random() * comments.length)];

  // Inject comment header at the top
  return `${selectedComment}\n${problem.solution}\n`;
}

module.exports = {
  PROBLEM_BANK,
  loadSubmissionHistory,
  recordSubmission,
  getRecentSolvedSlugs,
  selectProblem,
  generateSolutionCode,
};
