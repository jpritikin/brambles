+++
title = "Psilomethoxin, My Case Report (Addendum #2)"
tags = ["psychedelics", "science"]
date = "2023-10-09"
categories = ["opinion"]
menu = "main"
bookToc = false
+++

Purely based on subjective experience, I estimate the pharmacodynamics as:

````
pm <- function(x) 7.5*dchisq(4*(x-.5), 6)
````

The `x` axis is hours and the `y` axis is scaled so that 1 = a capsule of dried Pm mushroom powder.

![pd](psilomethoxin-pd.webp)

````
plot(function(x) pm(x), 0,6, xlab="hours",ylab="capsules")
````

Using this function, you can estimate the effect of multiple capsules taken at different times. For example, suppose you take 2 at 10am, 1 at 10:45am, 1 at 11:15am, and 1 at 11:45am. If you space out 5 capsules like this then the peak is only about 3.5 capsules worth at 1pm:

![pd](psilomethoxin-pd-5.webp)

````
plot(function(x) 2*pm(x) + pm(x-.75) + pm(x-1.25) + pm(x-1.75), 0,7, xlab="hours",ylab="capsules")
````

For background, see [Psilomethoxin, My Case Report](/posts/psilomethoxin-case-report).
